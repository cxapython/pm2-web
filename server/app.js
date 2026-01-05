var winston = require("winston"),
	Container = require("wantsit").Container,
	express = require("express"),
	http = require("http"),
	https = require("https"),
	path = require("path"),
	WebSocketServer = require("ws").WebSocketServer,
	EventEmitter = require("wildemitter"),
	util = require("util"),
	fs = require("fs");

var REQUIRED_PM2_VERSION = "5.0.0";

PM2Web = function(options) {
	EventEmitter.call(this);

	// create container
	this._container = new Container();

	// set up logging with winston 3.x
	this._container.createAndRegister("logger", winston.createLogger, {
		level: 'info',
		format: winston.format.combine(
			winston.format.timestamp(),
			winston.format.colorize(),
			winston.format.printf(({ level, message, timestamp, ...meta }) => {
				const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
				return `${timestamp} ${level}: ${message}${metaStr}`;
			})
		),
		transports: [
			new winston.transports.Console()
		]
	});

	// non-optional options
	options = options || {};
	options.requiredPm2Version = REQUIRED_PM2_VERSION;

	// parse configuration
	this._container.createAndRegister("config", require(__dirname + "/components/Configuration"), options);

	// web controllers
	this._container.createAndRegister("homeController", require(__dirname + "/routes/Home"));

	// listens for events - use PM2 programmatic API
	this._container.createAndRegister("pm2Listener", require(__dirname + "/components/PM2Listener"));

	// create express
	this._express = this._createExpress();

	// http(s) server
	this._server = this._createServer(this._express);

	// web sockets - Create WebSocketServer directly (ws 8.x is an ES6 class)
	var wss = new WebSocketServer({
		server: this._server,
		path: "/ws"
	});
	this._container.register("webSocketServer", wss);
	this._container.createAndRegister("webSocketResponder", require(__dirname + "/components/WebSocketResponder"));

	// holds host data
	this._container.createAndRegister("hostList", require(__dirname + "/components/ServerHostList"));

	// make errors a little more descriptive
	process.on("uncaughtException", function (exception) {
		this._container.find("logger").error("Uncaught exception", { stack: exception && exception.stack ? exception.stack : "No stack trace available" });

		throw exception;
	}.bind(this));

	// make sure we shut down cleanly
	process.on("SIGINT", this.stop.bind(this));

	// make sure we shut down cleanly
	process.on("message", function(message) {
		if (message == "shutdown") {
			this.stop();
		}
	}.bind(this));

	// make sure we shut down cleanly
	process.on("exit", this.stop.bind(this));
};
util.inherits(PM2Web, EventEmitter);

PM2Web.prototype._route = function(expressApp, controller, url, method) {
	var component = this._container.find(controller);

	expressApp[method](url, component[method].bind(component));
};

PM2Web.prototype._createServer = function(expressApp) {
	var config = this._container.find("config");

	if(config.get("www:ssl:enabled")) {
		if(config.get("www:ssl:upgrade")) {
			// create an app that will redirect all requests to the https version
			var httpsUrl = "https://" + config.get("www:host");

			if(config.get("www:ssl:port") != 443) {
				httpsUrl += ":" + config.get("www:ssl:port");
			}

			var redirectApp = express();
			redirectApp.get("*", function(request, response){
				response.redirect(httpsUrl + request.url);
			});
			process.nextTick(function() {
				this._redirectServer = http.createServer(redirectApp);
				this._redirectServer.listen(config.get("www:port"), function() {
					this._container.find("logger").info("HTTP to HTTPS upgrade server listening on port " + this._redirectServer.address().port);
				}.bind(this));
			}.bind(this));
		}

		return https.createServer({
			passphrase: config.get("www:ssl:passphrase"),
			key: fs.readFileSync(config.get("www:ssl:key")),
			cert: fs.readFileSync(config.get("www:ssl:certificate"))
		}, this._express);
	}

	return http.createServer(expressApp);
};

PM2Web.prototype._createExpress = function() {
	var config = this._container.find("config");
	var port = config.get("www:port");

	if(config.get("www:ssl:enabled")) {
		port = config.get("www:ssl:port");
	}

	var app = express();
	app.set("port", port);
	app.set("view engine", "pug");
	app.set("views", __dirname + "/views");

	// Express 4.x middleware
	app.use(express.urlencoded({ extended: true }));
	app.use(express.json());

	// HTTP Basic Auth (if enabled)
	if(config.get("www:authentication:enabled")) {
		var username = config.get("www:authentication:username");
		var password = config.get("www:authentication:password");
		
		app.use(function(req, res, next) {
			var auth = req.headers.authorization;
			if (!auth) {
				res.setHeader('WWW-Authenticate', 'Basic realm="pm2-web"');
				return res.status(401).send('Authentication required');
			}
			
			var parts = auth.split(' ');
			if (parts.length !== 2 || parts[0] !== 'Basic') {
				return res.status(401).send('Invalid authentication');
			}
			
			var credentials = Buffer.from(parts[1], 'base64').toString().split(':');
			var user = credentials[0];
			var pass = credentials.slice(1).join(':');
			
			if (user === username && pass === password) {
				return next();
			}
			
			res.setHeader('WWW-Authenticate', 'Basic realm="pm2-web"');
			return res.status(401).send('Invalid credentials');
		});
	}

	// create routes
	this._route(app, "homeController", "/", "get");
	this._route(app, "homeController", "/hosts/:host", "get");

	// static files
	app.use(express.static(__dirname + "/public"));

	// error handler
	app.use(function(err, req, res, next) {
		console.error(err.stack);
		res.status(500).send('Something broke!');
	});

	return app;
};

PM2Web.prototype.setAddress = function(address) {
	this._address = address;
};

PM2Web.prototype.getAddress = function() {
	return this._address;
};

PM2Web.prototype.start = function() {
	var config = this._container.find("config");

	process.nextTick(function() {
		this._server.listen(this._express.get("port"), config.get("www:address"), function() {
			this._container.find("logger").info("Express server listening on " + this._server.address().address + ":" + this._server.address().port);

			this.setAddress("http" + (config.get("www:ssl:enabled") ? "s": "") + "://" + config.get("www:host") + ":" + this._server.address().port);

			this.emit("start");
		}.bind(this));
	}.bind(this));
};

PM2Web.prototype.stop = function() {
	var logger = this._container.find("logger");

	if (this._stopping) return;
	this._stopping = true;

	logger.info("Shutting down Express");
	if (this._server) {
		this._server.close(function() {
			logger.info("Express shut down.");
		});
	}

	logger.info("Shutting WebSocket");
	var wsServer = this._container.find("webSocketServer");
	if (wsServer) {
		wsServer.close();
	}

	logger.info("Disconnecting from PM2");
	var pm2Listener = this._container.find("pm2Listener");
	if (pm2Listener) {
		pm2Listener.close();
	}

	if(this._redirectServer) {
		logger.info("Shutting down HTTP to HTTPS upgrade server");
		this._redirectServer.close(function() {
			logger.info("HTTP to HTTPS upgrade server shut down.");
		});
	}
};

module.exports = PM2Web;
