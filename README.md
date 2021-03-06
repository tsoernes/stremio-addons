
## What are Stremio add-ons?

**Stremio add-ons extend Stremio with content.**

That means either adding items to Discover or providing sources to stream content from.

Unlike regular software plugins, Stremio addons **do not run inside Stremio**, but instead are **accessed through HTTP over network**. You can think of them as **RSS on steroids**. Multiple addons can be activated, providing you more content, without any installation / security risks.

## stremio-addons
An Add-ons system that works like an RPC system, however it allows to **use multiple Add-ons through one interface** and it automatically **selects which add-on to handle the call**, depending the methods the Add-on provides (e.g. stream.get) and the priority of add-ons. You can also issue calls to all Add-ons and aggregate results (e.g. search metadata).

Stremio Add-ons are **loaded through HTTP**, so the Add-on has to have it's own server, provided by the Add-on provider. See "[Creating a basic Add-on](documentation/basic-addon.md)" for the reasons behind this approach.


#### Provides

* **Add-on server library**: what we use to initialize an HTTP server that provides a Stremio add-on.
* **Add-on client library**: a client library to use one or more Stremio add-ons

## Using add-ons in Stremio
```javascript
// pass your add-on's HTTP endpoint to --services argument to Stremio
// for example, if you're running an add-on locally at port 9008, do
/Applications/Stremio.app/Contents/MacOS/Electron . --services=http://localhost:9008

// Windows
%LOCALAPPDATA%\Programs\LNV\Stremio\Stremio.exe .. --services=http://localhost:9008

// this is the same for remote add-ons, for example --services=http://stremio-guidebox.herokuapp.com
```


## Documentation
1. [Creating a basic Add-on](documentation/basic-addon.md)
2. [Enabling Add-on in Stremio](documentation/enabling-addon.md)
3. [Methods](documentation/methods.md)
4. [Using Cinemeta](documentation/using-cinemeta.md)

## Client
```javascript
var addons = require("stremio-addons");
var stremio = new addons.Client({ /* options; picker: function(addons) { return addons } */ });
// specify a picker function to filter / sort the addons we'll use
// timeout: specify a request timeout
// respTimeout: specify response timeout

stremio.setAuth(url, authKey); // Set the authentication for addons that require auth
// URL is the URL to the central authentication server - some addons only permit certain servers
// authKey is the authentication token (user session key) or an Add-on secret if we're authenticating from an Add-on Server

stremio.add(URLtoAddon, { priority: 0 }); // Priority is an integer, zero is the highest priority
// OR
stremio.add(URLtoAddon);
// Priority determines which Add-on to pick first for an action, if several addons provide the same thing (e.g. streaming movies)

stremio.meta.get(args,cb); /* OR */ stremio.call("meta.get", args, cb);

// Events / hooks
stremio.on("pick", function(params) { 
	// called when picking addons
	// params.addons - all addons; you can modify this. e.g. params.addons = params.addons.filter(...)
	// params.method - the method we're picking for
	
	// this can be used instead of picker
});

stremio.on("addon-ready", function(addon, url) {
	// addon is an internal object - single Addon
	// url is the URL to it
});
```


## Server
```javascript
var addons = require("stremio-addons");
new addons.Server({
	"meta.get": function(args, cb) {
		// this.user -> get info about the user
	},
}, { secret: "SOME SECRET - or leave undefined for test secret" });
```
##### For the methods you can implement, and their expected input and output, see [methods](documentation/methods.md).

## Authentication
To authenticate when using Stremio Addons as a client, one must call
```javascript
client.setAuth(/* CENTRAL SERVER or null for default */, /* USER SESSION TOKEN (authToken) OR ADDON SECRET */);
```

**The authToken** is a session ID we use for addon clients to identify the user. The Addon Server (implemented in server.js) is responsible for evaluating if we're getting requests from a logged-in users. That happens by asking the **central server** if that authToken is valid and belongs to a user. 

**The secret** is a token, issued by a central server that we use to identify our Add-on server to the central server. We can also use our secret to identify ourselves to other Add-ons, if using them as a client - if our Add-on uses other Stremio add-ons under the hood (through the client library).

## Usage in browser 
```sh
browserify -r ./node_modules/stremio-addons/index.js:stremio-addons > stremio-addons.js
```
Or use the pre-built ``browser/stremio-addons.js`` with ``window.require("stremio-addons")``
```html
<script src="public/stremio-addons.js"></script>
<script>
var client = window.require("stremio-addons").Client();
/// ...
</script>
```

