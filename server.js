var _ = require("lodash");
var url = require("url");
var utils = require("./utils");
var async = require("async");

var SESSION_LIVE = 10*60*60*1000; // 10 hrs
var CACHE_TTL = 2.5 * 60 * 60; // seconds to live for the cache

function Server(methods, options, manifest)
{	
	options = _.extend({ 
		allow: [ module.parent.CENTRAL ], // default stremio central
		secret: "8417fe936f0374fbd16a699668e8f3c4aa405d9f" // default secret for testing add-ons
	}, options || { });

	Object.keys(methods).forEach(function(key) {
		if (typeof(methods[key]) != "function") throw Error(key+" should be a function");
	});

	// Announce to central
	var body = JSON.stringify({ id: manifest.id, manifest: _.omit(manifest, "filter") });
	var req = utils.http.request(_.extend(url.parse(module.parent.CENTRAL+"/stremio/announce/"+options.secret), { 
		method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } 
	}), function(res) { /* console.log(res.statusCode); currently we don't care */ });
	req.end(body);

	// Introspect the addon
	function meta(cb) {
		cb(null, {
			methods: Object.keys(methods),
			manifest: _.extend({ methods: Object.keys(methods) }, manifest || {})
		});
	};

	var sessions = { };
	var checkSession = async.queue(function(task, cb) {
		var auth = task.auth;
		if (options.allow && options.allow.indexOf(auth[0])==-1) return cb({ message: "not allowed to auth via that server", code: 2 });

		if (sessions[auth[1]]) return cb(null, sessions[auth[1]]);

		var req = utils.http.get(require("url").parse(auth[0]+"/stremio/service/"+options.secret+"/"+encodeURIComponent(auth[1])), function(resp) {
			utils.receiveJSON(resp, function(err, body) {
				if (resp.statusCode==200 && body) {
					sessions[auth[1]] = body;
					setTimeout(function() { delete sessions[auth[1]] }, SESSION_LIVE);
					return cb(null, body);
				};
				if (err) return cb(err);
				if (!body.message) console.error("auth server returned", body);
				return cb(body.message ? body : { message: "unknown error reaching auth server", code: 8 }); // error
			});
		});
		req.on("error", function(e) { cb({ message: "failed to connect to center", code: 5 }) });
	}, 1);

	this.middleware = function(req, res, next) {
		var start = Date.now(), finished = false;
		req._statsNotes = [];
		var getInfo = function() { return [req.url].concat(req._statsNotes).filter(function(x) { return x }) };
		if (process.env.STREMIO_LOGGING) {
			res.on("finish", function() {
				finished = true;
				console.log("\x1b[34m["+(new Date()).toISOString()+"]\x1b[0m -> \x1b[32m["+(Date.now()-start)+"ms]\x1b[0m "+getInfo().join(", ")+" / "+res.statusCode)
			});
			setTimeout(function() { if (!finished) console.log("-> \x1b[31m[WARNING]\x1b[0m "+getInfo().join(", ")+" taking more than 3000ms to run") }, 3000);
		}

		// Only serves stremio endpoint - currently /stremio/v1
		var parsed = url.parse(req.url);
		if (! parsed.pathname.match(module.parent.STREMIO_PATH)) return next(); 
		
		if (req.method === "OPTIONS") {
			var headers = {};
			headers["Access-Control-Allow-Origin"] = "*";
			headers["Access-Control-Allow-Methods"] = "POST, GET, PUT, DELETE, OPTIONS";
			headers["Access-Control-Allow-Credentials"] = false;
			headers["Access-Control-Max-Age"] = "86400"; // 24 hours
			headers["Access-Control-Allow-Headers"] = "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept";
			res.writeHead(200, headers);
			res.end();
			return;
		};
		
		if (req.method == "POST" || ( req.method == "GET" && parsed.pathname.match("q.json$") ) ) return serveRPC(req, res, function(method, params, cb) {
			if (method == "meta") return meta(cb);
			if (! methods[method]) return cb({ message: "method not supported", code: -32601 }, null);

			var auth = params[0], args = params[1];
			if (options.stremioget && req.method == "GET" && !method.match("stats")) return methods[method](args, cb, { stremioget: true }); // everything is allowed without auth in stremioget mode
			if (!(auth && auth[1]) && methods[method].noauth) return methods[method](args, cb, { noauth: true }); // the function is allowed without auth
			if (! auth) return cb({ message: "auth not specified", code: 1 });
			
			checkSession.push({ auth: auth }, function(err, session) {
				if (err && methods[method].noauth) return methods[method](args, cb, { noauth: true }); // the function is allowed without auth
				if (err) return cb(err);
				methods[method](args, cb, session);
			});
		}); else if (req.method == "GET") { // unsupported by JSON-RPC, it uses post
			utils.http.get(require("url").parse(module.parent.CENTRAL+"/stremio/addon/"+manifest.id+"?announce="+encodeURIComponent("http://"+req.headers.host+req.url)), function(resp) { resp.pipe(res) });
			return;
		}

		res.writeHead(405); // method not allowed
		res.end();
	};

	function serveRPC(req, res, handle) {
		var isGet = req.url.match("q.json");
		var isJson = req.headers["content-type"] && req.headers["content-type"].match("^application/json");
		if (!(isGet || isJson)) return res.writeHead(415); // unsupported media type
		res.setHeader("Access-Control-Allow-Origin", "*");

		function formatResp(id, err, body) {
			var respBody = { jsonrpc: "2.0", id: id };
			if (err) respBody.error = { message: err.message, code: err.code || -32603 };
			else respBody.result = body;
			return respBody;
		};
		function send(respBody) {
			respBody = JSON.stringify(respBody);
			res.setHeader("Content-Type", "application/json");
			res.setHeader("Content-Length", Buffer.byteLength(respBody, "utf8"));
			res.setHeader("Cache-Control", "public, max-age="+(options.cacheTTL || CACHE_TTL ) ); // around 2 hours default
			res.end(respBody);
		};

		utils.receiveJSON(req, function(err, body) {
			if (err) return send({ code: -32700, message: "parse error" }); // TODO: jsonrpc, id prop
			
			if (Array.isArray(body)) {
				async.map(body, function(b, cb) { 
					// WARNING: same logic as -->
					if (!b || !b.id || !b.method) return cb(null, formatResp(null, { code: -32700, message: "parse error" })); 
					handle(b.method, b.params, function(err, bb) { cb(null, formatResp(b.id, err, bb)) });
				}, function(err, bodies) { send(bodies) });
			} else { 
				// --> THIS
				if (!body || !body.id || !body.method) return send(formatResp(null, { code: -32700, message: "parse error" }));
				handle(body.method, body.params, function(err, b) { send(formatResp(body.id, err, b)) });
			}
		});
	};
};

module.exports = Server;
