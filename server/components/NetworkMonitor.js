/**
 * NetworkMonitor - 网络流量监控模块
 * 
 * 提供系统级和进程级的网络 I/O 监控功能
 * - 系统级：总带宽使用（上传/下载速度）
 * - 进程级：通过 /proc/[pid]/io 获取进程 I/O（主要适用于 Linux）
 */

var fs = require("fs");
var os = require("os");
var { execSync } = require("child_process");

var NetworkMonitor = function() {
	this._lastSystemNetStats = null;
	this._lastSystemNetTime = null;
	this._lastProcessIOStats = {}; // pid -> {read, write, time}
};

/**
 * 获取系统网络接口统计
 * @returns {Object} { interfaces: [...], total: { rx_bytes, tx_bytes, rx_speed, tx_speed } }
 */
NetworkMonitor.prototype.getSystemNetworkStats = function() {
	var platform = process.platform;
	var now = Date.now();
	var stats = { interfaces: [], total: { rx_bytes: 0, tx_bytes: 0, rx_speed: 0, tx_speed: 0 } };
	
	try {
		if (platform === 'linux') {
			stats = this._getLinuxNetworkStats();
		} else if (platform === 'darwin') {
			stats = this._getMacNetworkStats();
		}
		
		// 计算速度（与上次相比）
		if (this._lastSystemNetStats && this._lastSystemNetTime) {
			var timeDiff = (now - this._lastSystemNetTime) / 1000; // 秒
			if (timeDiff > 0) {
				stats.total.rx_speed = Math.max(0, (stats.total.rx_bytes - this._lastSystemNetStats.rx_bytes) / timeDiff);
				stats.total.tx_speed = Math.max(0, (stats.total.tx_bytes - this._lastSystemNetStats.tx_bytes) / timeDiff);
			}
		}
		
		this._lastSystemNetStats = { rx_bytes: stats.total.rx_bytes, tx_bytes: stats.total.tx_bytes };
		this._lastSystemNetTime = now;
		
	} catch (e) {
		// 静默失败
	}
	
	return stats;
};

/**
 * Linux 平台获取网络统计
 */
NetworkMonitor.prototype._getLinuxNetworkStats = function() {
	var stats = { interfaces: [], total: { rx_bytes: 0, tx_bytes: 0, rx_speed: 0, tx_speed: 0 } };
	
	try {
		var content = fs.readFileSync('/proc/net/dev', 'utf8');
		var lines = content.split('\n');
		
		for (var i = 2; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			
			// 格式: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
			var parts = line.split(/\s+/);
			var iface = parts[0].replace(':', '');
			
			// 跳过 lo (loopback)
			if (iface === 'lo') continue;
			
			var rx_bytes = parseInt(parts[1], 10) || 0;
			var tx_bytes = parseInt(parts[9], 10) || 0;
			
			stats.interfaces.push({
				name: iface,
				rx_bytes: rx_bytes,
				tx_bytes: tx_bytes
			});
			
			stats.total.rx_bytes += rx_bytes;
			stats.total.tx_bytes += tx_bytes;
		}
	} catch (e) {
		// 静默失败
	}
	
	return stats;
};

/**
 * macOS 平台获取网络统计
 */
NetworkMonitor.prototype._getMacNetworkStats = function() {
	var stats = { interfaces: [], total: { rx_bytes: 0, tx_bytes: 0, rx_speed: 0, tx_speed: 0 } };
	
	try {
		// 使用 netstat 获取网络统计
		var output = execSync('netstat -ib', { encoding: 'utf8', timeout: 5000 });
		var lines = output.split('\n');
		var seen = {};
		
		for (var i = 1; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			
			var parts = line.split(/\s+/);
			if (parts.length < 10) continue;
			
			var iface = parts[0];
			
			// 跳过 lo 和已处理的接口
			if (iface === 'lo0' || seen[iface]) continue;
			
			// 只处理有 IP 地址的接口（通常是活动的）
			var address = parts[3];
			if (!address || address === '--') continue;
			
			// macOS netstat -ib 格式：
			// Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
			var rx_bytes = parseInt(parts[6], 10) || 0;
			var tx_bytes = parseInt(parts[9], 10) || 0;
			
			if (rx_bytes > 0 || tx_bytes > 0) {
				seen[iface] = true;
				stats.interfaces.push({
					name: iface,
					rx_bytes: rx_bytes,
					tx_bytes: tx_bytes
				});
				
				stats.total.rx_bytes += rx_bytes;
				stats.total.tx_bytes += tx_bytes;
			}
		}
	} catch (e) {
		// 静默失败，尝试备用方法
		try {
			// 备用：使用 nettop 简化输出
			var output = execSync("netstat -I en0 -b | tail -1", { encoding: 'utf8', timeout: 3000 });
			var parts = output.trim().split(/\s+/);
			if (parts.length >= 10) {
				stats.total.rx_bytes = parseInt(parts[6], 10) || 0;
				stats.total.tx_bytes = parseInt(parts[9], 10) || 0;
			}
		} catch (e2) {
			// 静默失败
		}
	}
	
	return stats;
};

/**
 * 获取进程 I/O 统计（主要用于 Linux）
 * @param {number} pid - 进程 ID
 * @returns {Object} { read_bytes, write_bytes, read_speed, write_speed }
 */
NetworkMonitor.prototype.getProcessIOStats = function(pid) {
	var platform = process.platform;
	var now = Date.now();
	var stats = { read_bytes: 0, write_bytes: 0, read_speed: 0, write_speed: 0 };
	
	if (!pid || pid <= 0) return stats;
	
	try {
		if (platform === 'linux') {
			stats = this._getLinuxProcessIO(pid);
		} else if (platform === 'darwin') {
			stats = this._getMacProcessIO(pid);
		}
		
		// 计算速度
		var lastStats = this._lastProcessIOStats[pid];
		if (lastStats && lastStats.time) {
			var timeDiff = (now - lastStats.time) / 1000;
			if (timeDiff > 0) {
				stats.read_speed = Math.max(0, (stats.read_bytes - lastStats.read_bytes) / timeDiff);
				stats.write_speed = Math.max(0, (stats.write_bytes - lastStats.write_bytes) / timeDiff);
			}
		}
		
		this._lastProcessIOStats[pid] = {
			read_bytes: stats.read_bytes,
			write_bytes: stats.write_bytes,
			time: now
		};
		
	} catch (e) {
		// 静默失败
	}
	
	return stats;
};

/**
 * Linux 获取进程 I/O
 */
NetworkMonitor.prototype._getLinuxProcessIO = function(pid) {
	var stats = { read_bytes: 0, write_bytes: 0, read_speed: 0, write_speed: 0 };
	
	try {
		var content = fs.readFileSync('/proc/' + pid + '/io', 'utf8');
		var lines = content.split('\n');
		
		lines.forEach(function(line) {
			if (line.startsWith('read_bytes:')) {
				stats.read_bytes = parseInt(line.split(':')[1].trim(), 10) || 0;
			} else if (line.startsWith('write_bytes:')) {
				stats.write_bytes = parseInt(line.split(':')[1].trim(), 10) || 0;
			}
		});
	} catch (e) {
		// 进程可能已结束或无权限
	}
	
	return stats;
};

/**
 * macOS 获取进程 I/O（功能有限）
 */
NetworkMonitor.prototype._getMacProcessIO = function(pid) {
	var stats = { read_bytes: 0, write_bytes: 0, read_speed: 0, write_speed: 0 };
	
	try {
		// macOS 需要 root 权限使用 dtrace，这里使用 ps 获取大致信息
		// 注意：这只是估算，不是精确的 I/O
		var output = execSync('ps -o rss= -p ' + pid, { encoding: 'utf8', timeout: 3000 });
		// macOS 没有简单方法获取进程级 I/O，返回空值
	} catch (e) {
		// 静默失败
	}
	
	return stats;
};

/**
 * 清理已结束进程的缓存
 * @param {Array} activePids - 当前活动的进程 PID 列表
 */
NetworkMonitor.prototype.cleanupStaleProcesses = function(activePids) {
	var self = this;
	var pidSet = {};
	
	activePids.forEach(function(pid) {
		pidSet[pid] = true;
	});
	
	Object.keys(this._lastProcessIOStats).forEach(function(pid) {
		if (!pidSet[pid]) {
			delete self._lastProcessIOStats[pid];
		}
	});
};

/**
 * 格式化字节为人类可读的格式
 * @param {number} bytes
 * @param {boolean} perSecond - 是否是每秒速率
 * @returns {string}
 */
NetworkMonitor.formatBytes = function(bytes, perSecond) {
	if (bytes === 0) return perSecond ? '0 B/s' : '0 B';
	
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var i = Math.floor(Math.log(bytes) / Math.log(1024));
	i = Math.min(i, units.length - 1);
	
	var value = bytes / Math.pow(1024, i);
	var suffix = perSecond ? '/s' : '';
	
	return value.toFixed(2) + ' ' + units[i] + suffix;
};

module.exports = NetworkMonitor;
