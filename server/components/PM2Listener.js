var Autowire = require("wantsit").Autowire,
	EventEmitter = require("wildemitter"),
	util = require("util"),
	semver = require("semver"),
	pm2 = require("pm2"),
	os = require("os"),
	pkg = require(__dirname + "/../../package.json");

var DEFAULT_DEBUG_PORT = 5858;

var PM2Listener = function() {
	EventEmitter.call(this);

	this._config = Autowire;
	this._logger = Autowire;

	this._connected = false;
	this._intervalId = null;
};
util.inherits(PM2Listener, EventEmitter);

PM2Listener.prototype.afterPropertiesSet = function() {
	this._connect();
};

PM2Listener.prototype.close = function() {
	if (this._intervalId) {
		clearInterval(this._intervalId);
		this._intervalId = null;
	}
	
	if (this._connected) {
		pm2.disconnect();
		this._connected = false;
	}
};

PM2Listener.prototype._connect = function() {
	var self = this;
	
	this._logger.info("Connecting to PM2...");

	pm2.connect(function(err) {
		if (err) {
			self._logger.error("Failed to connect to PM2", { error: err.message });
			
			// Retry connection after 5 seconds
			setTimeout(function() {
				self._connect();
			}, 5000);
			return;
		}

		self._connected = true;
		self._logger.info("Connected to PM2");

		// Get PM2 version
		self._checkVersion();

		// Start polling for system data
		self._startPolling();

		// Setup PM2 event bus for logs
		self._setupEventBus();
	});
};

PM2Listener.prototype._checkVersion = function() {
	var self = this;
	
	// PM2 version check using pm2.Client or fallback
	try {
		var pm2Pkg = require('pm2/package.json');
		var version = pm2Pkg.version;
		
		self._pm2Version = version;
		self._pm2Compatible = semver.gte(version, self._config.get("requiredPm2Version"));
		
		if (!self._pm2Compatible) {
			self._logger.warn("PM2 version " + version + " may not be fully compatible with pm2-web " + pkg.version);
		} else {
			self._logger.info("PM2 version: " + version);
		}
	} catch (e) {
		self._logger.warn("Could not determine PM2 version");
		self._pm2Version = "unknown";
		self._pm2Compatible = true;
	}
};

PM2Listener.prototype._startPolling = function() {
	var self = this;
	var updateFrequency = this._config.get("updateFrequency") || 5000;

	// Initial fetch
	this._getSystemData();

	// Setup interval for polling
	this._intervalId = setInterval(function() {
		self._getSystemData();
	}, updateFrequency);
};

PM2Listener.prototype._getSystemData = function() {
	var self = this;

	pm2.list(function(err, processList) {
		if (err) {
			self._logger.warn("Error retrieving PM2 process list", { error: err.message });
			return;
		}

		var systemData = self._mapSystemData(processList);
		self.emit("systemData", systemData);
	});
};

PM2Listener.prototype._mapSystemData = function(processList) {
	var now = Date.now();
	var cpus = os.cpus();
	var loadavg = os.loadavg();
	
	var systemData = {
		name: "localhost",
		inspector: this._config.get("pm2:0:inspector"),
		system: {
			hostname: os.hostname(),
			cpu_count: cpus.length,
			load: [loadavg[0], loadavg[1], loadavg[2]],
			uptime: os.uptime(),
			memory: {
				free: os.freemem(),
				total: os.totalmem()
			},
			time: now
		},
		pm2: {
			version: this._pm2Version,
			compatible: this._pm2Compatible
		},
		processes: []
	};

	var reloading = [];

	processList.forEach(function(proc) {
		if (!proc || !proc.pm2_env) return;

		var pm_id = proc.pm_id;
		
		// Check for processes being reloaded
		if ((typeof pm_id === "string" || pm_id instanceof String) && pm_id.substring(0, 8) === "todelete") {
			reloading.push(parseInt(pm_id.substring(8), 10));
			return;
		}

		var pm2_env = proc.pm2_env;
		var monit = proc.monit || { memory: 0, cpu: 0 };

		// Handle various status values
		var status = pm2_env.status;
		if (!status) {
			status = pm2_env.pm2_env_status || "unknown";
		}

		// Get execution mode
		var mode = "fork";
		if (pm2_env.exec_mode) {
			var modeStr = pm2_env.exec_mode.toString();
			var underscoreIdx = modeStr.indexOf("_");
			mode = underscoreIdx > 0 ? modeStr.substring(0, underscoreIdx) : modeStr;
		}

		// Calculate uptime
		var uptime = 0;
		if (pm2_env.pm_uptime) {
			uptime = (now - pm2_env.pm_uptime) / 1000;
		}

		systemData.processes.push({
			id: proc.pm_id,
			pid: proc.pid,
			name: pm2_env.name,
			script: pm2_env.pm_exec_path,
			uptime: uptime,
			restarts: pm2_env.restart_time || 0,
			status: status,
			memory: monit.memory,
			cpu: monit.cpu,
			mode: mode,
			debugPort: this._findDebugPort(pm2_env.node_args || pm2_env.nodeArgs)
		});
	}.bind(this));

	// Mark processes that are reloading as such
	systemData.processes.forEach(function(process) {
		process.reloading = reloading.indexOf(process.id) !== -1;
	});

	return systemData;
};

PM2Listener.prototype._setupEventBus = function() {
	var self = this;

	pm2.launchBus(function(err, bus) {
		if (err) {
			self._logger.warn("Could not launch PM2 event bus", { error: err.message });
			return;
		}

		self._logger.info("PM2 event bus connected");

		// Listen for log events
		bus.on('log:out', function(data) {
			self.emit('log:out', {
				name: 'localhost',
				process: { pm_id: data.process.pm_id },
				data: data.data
			});
		});

		bus.on('log:err', function(data) {
			self.emit('log:err', {
				name: 'localhost',
				process: { pm_id: data.process.pm_id },
				data: data.data
			});
		});

		// Listen for process events
		bus.on('process:exception', function(data) {
			self.emit('process:exception', {
				name: 'localhost',
				process: data.process,
				data: data.data,
				err: data.err
			});
		});

		bus.on('process:event', function(data) {
			self._logger.info("Process event", { event: data.event, name: data.process ? data.process.name : 'unknown' });
		});
	});
};

PM2Listener.prototype.stopProcess = function(host, pm_id) {
	var self = this;
	this._logger.info("Stopping process", { pm_id: pm_id });
	
	pm2.stop(pm_id, function(err) {
		if (err) {
			self._logger.error("Error stopping process", { pm_id: pm_id, error: err.message });
		}
	});
};

PM2Listener.prototype.startProcess = function(host, pm_id) {
	var self = this;
	this._logger.info("Starting process", { pm_id: pm_id });
	
	// PM2's restart also works for starting stopped processes
	pm2.restart(pm_id, function(err) {
		if (err) {
			self._logger.error("Error starting process", { pm_id: pm_id, error: err.message });
		}
	});
};

PM2Listener.prototype.restartProcess = function(host, pm_id) {
	var self = this;
	this._logger.info("Restarting process", { pm_id: pm_id });
	
	pm2.restart(pm_id, function(err) {
		if (err) {
			self._logger.error("Error restarting process", { pm_id: pm_id, error: err.message });
		}
	});
};

PM2Listener.prototype.reloadProcess = function(host, pm_id) {
	var self = this;
	this._logger.info("Reloading process", { pm_id: pm_id });
	
	pm2.reload(pm_id, function(err) {
		if (err) {
			self._logger.error("Error reloading process", { pm_id: pm_id, error: err.message });
		}
	});
};

PM2Listener.prototype.debugProcess = function(host, pm_id) {
	var self = this;
	this._logger.info("Sending debug signal to process", { pm_id: pm_id });
	
	pm2.sendSignalToProcessId('SIGUSR1', pm_id, function(err) {
		if (err) {
			self._logger.error("Error sending debug signal", { pm_id: pm_id, error: err.message });
		}
	});
};

PM2Listener.prototype._findDebugPort = function(execArgv) {
	var port = DEFAULT_DEBUG_PORT;

	if (Array.isArray(execArgv)) {
		execArgv.forEach(function(argument) {
			if (!argument) return;
			
			[/--debug\s*=?\s*([0-9]+)/, /--debug-brk\s*=?\s*([0-9]+)/, /--inspect\s*=?\s*([0-9]+)/, /--inspect-brk\s*=?\s*([0-9]+)/].forEach(function(regex) {
				var matches = argument.match(regex);

				if (matches && matches.length > 1) {
					port = parseInt(matches[1], 10);
				}
			});
		});
	}

	return port;
};

module.exports = PM2Listener;
