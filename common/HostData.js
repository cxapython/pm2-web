var ProcessData = require("./ProcessData");

var HostData = function(data, config) {
	Object.defineProperty(this, "_config", {
		enumerable: false,
		value: config
	});

	this.name = data.name;
	this.inspector = data.inspector;
	this.pm2 = data.pm2,
	this.system = {};
	this.processes = [];
};

HostData.prototype.update = function(data) {
	this.lastUpdated = Date.now();

	["hostname", "cpu_count", "uptime", "time"].forEach(function(key) {
		this.system[key] = data.system[key]
	}.bind(this));

	this.system.load = [
		data.system.load[0],
		data.system.load[1],
		data.system.load[2]
	];
	this.system.memory = {
		free: data.system.memory.free,
		total: data.system.memory.total,
		used: data.system.memory.total - data.system.memory.free
	};
	
	// 更新网络数据
	if (data.system.network) {
		this.system.network = {
			rx_bytes: data.system.network.rx_bytes || 0,
			tx_bytes: data.system.network.tx_bytes || 0,
			rx_speed: data.system.network.rx_speed || 0,
			tx_speed: data.system.network.tx_speed || 0,
			interfaces: data.system.network.interfaces || []
		};
		
		// 存储历史网络速度数据
		if (!this.system.networkHistory) {
			this.system.networkHistory = { rx: [], tx: [] };
		}
		this._appendNetworkHistory(data.system.network.rx_speed, data.system.network.tx_speed, data.system.time);
	}

	this._removeMissingProcesses(data.processes);

	data.processes.forEach(function(reportedProcess) {
		var existingProcess = this.findProcessById(reportedProcess.id);

		if(!existingProcess) {
			existingProcess = new ProcessData(this._config, reportedProcess);
			this.processes.push(existingProcess);
		}

		existingProcess.update(reportedProcess, data.system);
	}.bind(this));
};

HostData.prototype._appendNetworkHistory = function(rx_speed, tx_speed, time) {
	var maxDatapoints = this._config.get("graph:datapoints") || 1000;
	
	// 转换为 KB/s
	var rxKBs = (rx_speed || 0) / 1024;
	var txKBs = (tx_speed || 0) / 1024;
	
	this.system.networkHistory.rx.push({ x: time, y: rxKBs });
	this.system.networkHistory.tx.push({ x: time, y: txKBs });
	
	// 限制数据点数量
	if (this.system.networkHistory.rx.length > maxDatapoints) {
		this.system.networkHistory.rx = this.system.networkHistory.rx.slice(-maxDatapoints);
	}
	if (this.system.networkHistory.tx.length > maxDatapoints) {
		this.system.networkHistory.tx = this.system.networkHistory.tx.slice(-maxDatapoints);
	}
};

HostData.prototype._removeMissingProcesses = function(reportedProcesses) {
	this.processes = this.processes.filter(function(existingProcess) {
		for(var i = 0; i < reportedProcesses.length; i++) {
			if(reportedProcesses[i].name == existingProcess.name) {
				return true;
			}
		}

		return false;
	});
};

HostData.prototype.findProcessById = function(id) {
	for(var i = 0; i < this.processes.length; i++) {
		if(this.processes[i].id == id) {
			return this.processes[i];
		}
	}

	return null;
}

module.exports = HostData;