var Autowire = require("wantsit").Autowire,
	_s = require("underscore.string");

var WebSocketResponder = function() {
	this._config = Autowire;

	this._logger = Autowire;
	this._pm2Listener = Autowire;
	this._webSocketServer = Autowire;
	this._hostList = Autowire;
	this._events = [];
};

WebSocketResponder.prototype.afterPropertiesSet = function() {
	var logger = this._logger;
	var self = this;

	// Add broadcast method to WebSocket server (ws 8.x API)
	this._webSocketServer.broadcast = function(data) {
		var message = JSON.stringify(data);

		this.clients.forEach(function(client) {
			try {
				// ws 8.x uses readyState constants
				if (client.readyState === 1) { // WebSocket.OPEN
					client.send(message);
				}
			} catch(e) {
				logger.warn("Error broadcasting to client", { error: e.message });
			}
		});
	};

	// Handle new connections (ws 8.x API)
	this._webSocketServer.on("connection", function(client, request) {
		logger.info("New WebSocket connection from " + (request.socket.remoteAddress || 'unknown'));

		client.on("message", function(message) {
			try {
				// ws 8.x may provide Buffer or string
				var messageStr = message;
				if (Buffer.isBuffer(message)) {
					messageStr = message.toString('utf8');
				}
				
				var request = JSON.parse(messageStr);

				if(request.method && request.args && self[request.method]) {
					request.args.unshift(client);
					self[request.method].apply(self, request.args);
				}
			} catch (e) {
				logger.warn("Error processing WebSocket message", { error: e.message });
			}
		});

		client.on("error", function(error) {
			logger.warn("WebSocket client error", { error: error.message });
		});

		client.on("close", function() {
			logger.info("WebSocket client disconnected");
		});

		// Send config and all host data
		try {
			client.send(JSON.stringify([{
				method: "onConfig",
				args: [{
					graph: self._config.get("graph"),
					logs: self._config.get("logs"),
					updateFrequency: self._config.get("updateFrequency"),
					requiredPm2Version: self._config.get("requiredPm2Version")
				}]
			}, {
				method: "onHosts",
				args: [
					self._hostList.getHosts()
				]
			}]));
		} catch (e) {
			logger.warn("Error sending initial data to client", { error: e.message });
		}
	});

	// broadcast error logging
	this._pm2Listener.on("log:err", this._broadcastLog.bind(this, "error"));

	// broadcast info logging
	this._pm2Listener.on("log:out", this._broadcastLog.bind(this, "info"));

	// broadcast exceptions
	this._pm2Listener.on("process:exception", function(event) {
		var data = event.data ? event.data : event.err;
		var host, id, message, stack;

		host = event.name;

		if(event.process) {
			id = event.process.pm_id;
		}

		if (data) {
			message = data.message;
			stack = data.stack;
		}

		if(id === undefined || id === null) {
			return;
		}

		self._hostList.addLog(host, id, "error", stack || message || "Unknown exception");

		self._events.push({
			method: "onProcessException",
			args: [
				host, id, message, stack
			]
		});
	});

	// broadcast system data updates
	this._pm2Listener.on("systemData", function(data) {
		self._events.push({
			method: "onSystemData",
			args: [
				data
			]
		});
	});

	setInterval(this._processEvents.bind(this), this._config.get("ws:frequency"));
};

WebSocketResponder.prototype._processEvents = function() {
	if(this._events.length === 0) {
		return;
	}

	this._webSocketServer.broadcast(this._events);

	this._events.length = 0;
};

WebSocketResponder.prototype._broadcastLog = function(type, event) {
	if (!event.process) return;
	
	var id = event.process.pm_id;
	var log;

	// Handle various data formats
	if(event.data) {
		if(event.data.str) {
			log = event.data.str;
		} else if(Array.isArray(event.data)) {
			// Use Buffer.from() instead of deprecated new Buffer()
			log = Buffer.from(event.data).toString('utf8');
		} else if(Buffer.isBuffer(event.data)) {
			log = event.data.toString('utf8');
		} else {
			log = event.data.toString();
		}
	} else if(event.str) {
		log = event.str;
	}

	if(!log) {
		return;
	}

	if(log.trim) {
		log = log.trim();
	}

	this._hostList.addLog(event.name, id, type, log);

	this._events.push({
		method: "on" + _s.capitalize(type) + "Log",
		args: [
			event.name, id, log
		]
	});
};

WebSocketResponder.prototype.startProcess = function(client, host, pm_id) {
	this._pm2Listener.startProcess(host, pm_id);
};

WebSocketResponder.prototype.stopProcess = function(client, host, pm_id) {
	this._pm2Listener.stopProcess(host, pm_id);
};

WebSocketResponder.prototype.restartProcess = function(client, host, pm_id) {
	this._pm2Listener.restartProcess(host, pm_id);
};

WebSocketResponder.prototype.reloadProcess = function(client, host, pm_id) {
	this._pm2Listener.reloadProcess(host, pm_id);
};

WebSocketResponder.prototype.debugProcess = function(client, host, pm_id) {
	this._pm2Listener.debugProcess(host, pm_id);
};

module.exports = WebSocketResponder;
