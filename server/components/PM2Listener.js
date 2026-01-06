var Autowire = require("wantsit").Autowire,
	EventEmitter = require("wildemitter"),
	util = require("util"),
	semver = require("semver"),
	pm2 = require("pm2"),
	os = require("os"),
	fs = require("fs"),
	path = require("path"),
	{ execSync } = require("child_process"),
	pkg = require(__dirname + "/../../package.json"),
	NetworkMonitor = require("./NetworkMonitor");

var DEFAULT_DEBUG_PORT = 5858;
var DEFAULT_HISTORY_LINES = 100; // 默认读取最后100行历史日志

// 读取文件最后N行
function readLastLines(filePath, maxLines) {
	return new Promise(function(resolve, reject) {
		try {
			if (!fs.existsSync(filePath)) {
				return resolve([]);
			}
			
			var stats = fs.statSync(filePath);
			if (stats.size === 0) {
				return resolve([]);
			}
			
			// 对于大文件，从末尾开始读取
			var bufferSize = Math.min(stats.size, maxLines * 500); // 估算每行约500字节
			var buffer = Buffer.alloc(bufferSize);
			var fd = fs.openSync(filePath, 'r');
			
			try {
				var startPos = Math.max(0, stats.size - bufferSize);
				fs.readSync(fd, buffer, 0, bufferSize, startPos);
				
				var content = buffer.toString('utf8');
				var lines = content.split('\n').filter(function(line) {
					return line.trim().length > 0;
				});
				
				// 如果不是从文件开头读取，丢弃第一行（可能不完整）
				if (startPos > 0 && lines.length > 0) {
					lines.shift();
				}
				
				// 只取最后N行
				if (lines.length > maxLines) {
					lines = lines.slice(-maxLines);
				}
				
				resolve(lines);
			} finally {
				fs.closeSync(fd);
			}
		} catch (e) {
			resolve([]);
		}
	});
}

// 获取更准确的可用内存（macOS 特殊处理）
function getAvailableMemory() {
	var total = os.totalmem();
	
	if (process.platform === 'darwin') {
		try {
			// 在 macOS 上使用 vm_stat 获取更准确的内存信息
			var vmstat = execSync('vm_stat', { encoding: 'utf8' });
			var pageSize = 16384; // macOS 默认页面大小
			
			// 解析 vm_stat 输出
			var pageSizeMatch = vmstat.match(/page size of (\d+) bytes/);
			if (pageSizeMatch) {
				pageSize = parseInt(pageSizeMatch[1]);
			}
			
			var freeMatch = vmstat.match(/Pages free:\s+(\d+)/);
			var inactiveMatch = vmstat.match(/Pages inactive:\s+(\d+)/);
			var speculativeMatch = vmstat.match(/Pages speculative:\s+(\d+)/);
			var purgeableMatch = vmstat.match(/Pages purgeable:\s+(\d+)/);
			
			var freePages = freeMatch ? parseInt(freeMatch[1]) : 0;
			var inactivePages = inactiveMatch ? parseInt(inactiveMatch[1]) : 0;
			var speculativePages = speculativeMatch ? parseInt(speculativeMatch[1]) : 0;
			var purgeablePages = purgeableMatch ? parseInt(purgeableMatch[1]) : 0;
			
			// 可用内存 = 空闲 + 非活跃 + 推测 + 可清除
			var available = (freePages + inactivePages + speculativePages + purgeablePages) * pageSize;
			return {
				free: available,
				total: total,
				used: total - available
			};
		} catch (e) {
			// 回退到默认方法
		}
	}
	
	// 其他系统或出错时使用默认方法
	var free = os.freemem();
	return {
		free: free,
		total: total,
		used: total - free
	};
}

var PM2Listener = function() {
	EventEmitter.call(this);

	this._config = Autowire;
	this._logger = Autowire;

	this._connected = false;
	this._intervalId = null;
	this._processLogPaths = {}; // 存储进程日志路径
	this._loadedHistoryLogs = {}; // 跟踪已加载过历史日志的进程
	this._networkMonitor = new NetworkMonitor(); // 网络监控实例
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
		
		// 为新进程加载历史日志
		self._loadHistoryLogsForNewProcesses(processList);
	});
};

PM2Listener.prototype._loadHistoryLogsForNewProcesses = function(processList) {
	var self = this;
	var maxLines = this._config.get("logs:historyLines") || DEFAULT_HISTORY_LINES;
	
	processList.forEach(function(proc) {
		if (!proc || !proc.pm2_env) return;
		
		var pm_id = proc.pm_id;
		var logKey = "localhost:" + pm_id;
		
		// 如果已经加载过历史日志，跳过
		if (self._loadedHistoryLogs[logKey]) {
			return;
		}
		
		var pm2_env = proc.pm2_env;
		var outLogPath = pm2_env.pm_out_log_path;
		var errLogPath = pm2_env.pm_err_log_path;
		
		self._loadedHistoryLogs[logKey] = true;
		
		// 异步加载历史日志
		var loadPromises = [];
		
		if (outLogPath) {
			loadPromises.push(
				readLastLines(outLogPath, maxLines).then(function(lines) {
					lines.forEach(function(line) {
						self.emit('log:out', {
							name: 'localhost',
							process: { pm_id: pm_id },
							data: line,
							isHistory: true
						});
					});
				})
			);
		}
		
		if (errLogPath) {
			loadPromises.push(
				readLastLines(errLogPath, maxLines).then(function(lines) {
					lines.forEach(function(line) {
						self.emit('log:err', {
							name: 'localhost',
							process: { pm_id: pm_id },
							data: line,
							isHistory: true
						});
					});
				})
			);
		}
		
		if (loadPromises.length > 0) {
			Promise.all(loadPromises).then(function() {
				self._logger.info("Loaded history logs for process", { pm_id: pm_id, name: pm2_env.name });
			}).catch(function(err) {
				self._logger.warn("Error loading history logs", { pm_id: pm_id, error: err.message });
			});
		}
	});
};

PM2Listener.prototype._mapSystemData = function(processList) {
	var now = Date.now();
	var cpus = os.cpus();
	var loadavg = os.loadavg();
	var self = this;
	
	// 获取系统网络统计
	var networkStats = this._networkMonitor.getSystemNetworkStats();
	
	var systemData = {
		name: "localhost",
		inspector: this._config.get("pm2:0:inspector"),
		system: {
			hostname: os.hostname(),
			cpu_count: cpus.length,
			load: [loadavg[0], loadavg[1], loadavg[2]],
			uptime: os.uptime(),
			memory: getAvailableMemory(),
			time: now,
			network: {
				rx_bytes: networkStats.total.rx_bytes,
				tx_bytes: networkStats.total.tx_bytes,
				rx_speed: networkStats.total.rx_speed,
				tx_speed: networkStats.total.tx_speed,
				interfaces: networkStats.interfaces
			}
		},
		pm2: {
			version: this._pm2Version,
			compatible: this._pm2Compatible
		},
		processes: []
	};

	var reloading = [];
	var activePids = [];

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

		// 获取进程 I/O 统计
		var processIO = { read_bytes: 0, write_bytes: 0, read_speed: 0, write_speed: 0 };
		if (proc.pid && proc.pid > 0) {
			processIO = self._networkMonitor.getProcessIOStats(proc.pid);
			activePids.push(proc.pid);
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
			debugPort: self._findDebugPort(pm2_env.node_args || pm2_env.nodeArgs),
			io: {
				read_bytes: processIO.read_bytes,
				write_bytes: processIO.write_bytes,
				read_speed: processIO.read_speed,
				write_speed: processIO.write_speed
			}
		});
	});

	// 清理已结束进程的缓存
	this._networkMonitor.cleanupStaleProcesses(activePids);

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

// 获取进程的脚本路径信息
PM2Listener.prototype.getProcessScript = function(pm_id, callback) {
	var self = this;
	
	pm2.describe(pm_id, function(err, proc) {
		if (err || !proc || proc.length === 0) {
			return callback({ error: '无法找到进程' });
		}
		
		var processInfo = proc[0];
		var pm2_env = processInfo.pm2_env || {};
		
		var scriptPath = pm2_env.pm_exec_path;
		var cwd = pm2_env.pm_cwd;
		var interpreter = pm2_env.exec_interpreter || 'node';
		var args = pm2_env.args || [];
		
		// 检查是否是通过 bash -c 执行的命令
		// 例如: pm2 start "python3 main.py" 会变成 /bin/bash -c "python3 main.py"
		if ((scriptPath === '/bin/bash' || scriptPath === '/bin/sh') && interpreter === 'none') {
			var scriptArgs = pm2_env.pm_exec_path_args || pm2_env.args;
			
			if (scriptArgs && scriptArgs.length > 0) {
				// 解析 -c 后面的命令
				var cmdStr = '';
				for (var i = 0; i < scriptArgs.length; i++) {
					if (scriptArgs[i] === '-c' && i + 1 < scriptArgs.length) {
						cmdStr = scriptArgs[i + 1];
						break;
					}
				}
				
				if (!cmdStr && typeof scriptArgs === 'string') {
					cmdStr = scriptArgs;
				}
				
				if (cmdStr) {
					// 解析命令中的脚本文件
					// 例如: "python3 main.py" -> main.py
					// 例如: "python3 reddit_main.py --arg1 val1" -> reddit_main.py
					var parts = cmdStr.trim().split(/\s+/);
					for (var j = 0; j < parts.length; j++) {
						var part = parts[j];
						// 查找以 .py, .js, .ts, .sh 等结尾的文件
						if (/\.(py|js|ts|jsx|tsx|sh|rb|php|pl)$/i.test(part)) {
							// 如果是相对路径，结合 cwd
							if (!path.isAbsolute(part)) {
								scriptPath = path.join(cwd, part);
							} else {
								scriptPath = part;
							}
							
							// 从命令中推断解释器
							if (parts[0].includes('python')) {
								interpreter = 'python';
							} else if (parts[0].includes('node')) {
								interpreter = 'node';
							} else if (parts[0].includes('ruby')) {
								interpreter = 'ruby';
							}
							break;
						}
					}
				}
			}
		}
		
		// 验证脚本文件是否存在
		if (!fs.existsSync(scriptPath)) {
			self._logger.warn('脚本文件不存在', { path: scriptPath, cwd: cwd });
			return callback({ 
				error: '脚本文件不存在: ' + scriptPath + '\n工作目录: ' + cwd + '\n提示: 请确保在正确的目录下启动进程'
			});
		}
		
		callback({
			pm_id: pm_id,
			name: pm2_env.name,
			script: scriptPath,
			cwd: cwd,
			interpreter: interpreter
		});
	});
};

// 读取文件内容
PM2Listener.prototype.readFile = function(filePath, callback) {
	var self = this;
	
	// 安全检查：只允许读取特定类型的源代码文件
	var allowedExtensions = ['.js', '.ts', '.py', '.rb', '.php', '.sh', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.md', '.txt', '.html', '.css', '.vue', '.jsx', '.tsx'];
	var ext = path.extname(filePath).toLowerCase();
	
	if (!allowedExtensions.includes(ext) && ext !== '') {
		return callback({ error: '不支持的文件类型: ' + ext });
	}
	
	// 检查文件是否存在
	if (!fs.existsSync(filePath)) {
		return callback({ error: '文件不存在: ' + filePath });
	}
	
	try {
		var stats = fs.statSync(filePath);
		
		// 限制文件大小（最大 5MB）
		if (stats.size > 5 * 1024 * 1024) {
			return callback({ error: '文件过大，超过 5MB 限制' });
		}
		
		var content = fs.readFileSync(filePath, 'utf8');
		
		callback({
			path: filePath,
			content: content,
			size: stats.size,
			mtime: stats.mtime
		});
	} catch (e) {
		self._logger.error('读取文件失败', { path: filePath, error: e.message });
		callback({ error: '读取文件失败: ' + e.message });
	}
};

// 保存文件内容
PM2Listener.prototype.saveFile = function(filePath, content, callback) {
	var self = this;
	
	// 安全检查：只允许写入特定类型的源代码文件
	var allowedExtensions = ['.js', '.ts', '.py', '.rb', '.php', '.sh', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.md', '.txt', '.html', '.css', '.vue', '.jsx', '.tsx'];
	var ext = path.extname(filePath).toLowerCase();
	
	if (!allowedExtensions.includes(ext) && ext !== '') {
		return callback({ error: '不支持的文件类型: ' + ext });
	}
	
	try {
		// 创建备份
		if (fs.existsSync(filePath)) {
			var backupPath = filePath + '.backup.' + Date.now();
			fs.copyFileSync(filePath, backupPath);
			self._logger.info('创建文件备份', { original: filePath, backup: backupPath });
		}
		
		fs.writeFileSync(filePath, content, 'utf8');
		
		self._logger.info('文件已保存', { path: filePath });
		
		callback({
			success: true,
			path: filePath,
			message: '文件保存成功'
		});
	} catch (e) {
		self._logger.error('保存文件失败', { path: filePath, error: e.message });
		callback({ error: '保存文件失败: ' + e.message });
	}
};

// 解析 Python 文件的导入依赖
PM2Listener.prototype._parsePythonImports = function(content, cwd) {
	var imports = [];
	var lines = content.split('\n');
	
	lines.forEach(function(line) {
		// 匹配 from xxx import yyy 和 import xxx
		var fromMatch = line.match(/^\s*from\s+([^\s]+)\s+import/);
		var importMatch = line.match(/^\s*import\s+([^\s,]+)/);
		
		var moduleName = null;
		if (fromMatch) {
			moduleName = fromMatch[1];
		} else if (importMatch) {
			moduleName = importMatch[1];
		}
		
		if (moduleName && !moduleName.startsWith('.')) {
			// 转换模块名为路径
			var modulePath = moduleName.replace(/\./g, '/');
			var possiblePaths = [
				path.join(cwd, modulePath + '.py'),
				path.join(cwd, modulePath, '__init__.py'),
				path.join(cwd, modulePath + '/main.py')
			];
			
			possiblePaths.forEach(function(p) {
				if (fs.existsSync(p)) {
					imports.push({
						module: moduleName,
						path: p,
						exists: true
					});
				}
			});
		} else if (moduleName && moduleName.startsWith('.')) {
			// 相对导入
			var relativePath = moduleName.replace(/\./g, '/').slice(1);
			var possiblePath = path.join(cwd, relativePath + '.py');
			if (fs.existsSync(possiblePath)) {
				imports.push({
					module: moduleName,
					path: possiblePath,
					exists: true
				});
			}
		}
	});
	
	return imports;
};

// 解析 JavaScript/Node.js 文件的导入依赖
PM2Listener.prototype._parseJsImports = function(content, filePath) {
	var imports = [];
	var cwd = path.dirname(filePath);
	
	// 匹配 require() 和 import 语句
	var requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	var importRegex = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]/g;
	
	var match;
	var seen = {};
	
	while ((match = requireRegex.exec(content)) !== null) {
		var modulePath = match[1];
		if (modulePath.startsWith('.') && !seen[modulePath]) {
			seen[modulePath] = true;
			var resolvedPath = this._resolveJsPath(modulePath, cwd);
			if (resolvedPath) {
				imports.push({
					module: modulePath,
					path: resolvedPath,
					exists: true
				});
			}
		}
	}
	
	while ((match = importRegex.exec(content)) !== null) {
		var modulePath = match[1];
		if (modulePath.startsWith('.') && !seen[modulePath]) {
			seen[modulePath] = true;
			var resolvedPath = this._resolveJsPath(modulePath, cwd);
			if (resolvedPath) {
				imports.push({
					module: modulePath,
					path: resolvedPath,
					exists: true
				});
			}
		}
	}
	
	return imports;
};

// 解析 JS 模块路径
PM2Listener.prototype._resolveJsPath = function(modulePath, cwd) {
	var extensions = ['.js', '.ts', '.jsx', '.tsx', '.json', '/index.js', '/index.ts'];
	var fullPath = path.resolve(cwd, modulePath);
	
	// 直接路径
	if (fs.existsSync(fullPath)) {
		var stat = fs.statSync(fullPath);
		if (stat.isFile()) {
			return fullPath;
		} else if (stat.isDirectory()) {
			// 检查 index 文件
			for (var i = 0; i < extensions.length; i++) {
				if (extensions[i].startsWith('/')) {
					var indexPath = fullPath + extensions[i];
					if (fs.existsSync(indexPath)) {
						return indexPath;
					}
				}
			}
		}
	}
	
	// 带扩展名
	for (var i = 0; i < extensions.length; i++) {
		if (!extensions[i].startsWith('/')) {
			var withExt = fullPath + extensions[i];
			if (fs.existsSync(withExt)) {
				return withExt;
			}
		}
	}
	
	return null;
};

// 获取文件的本地依赖
PM2Listener.prototype.getFileDependencies = function(filePath, callback) {
	var self = this;
	
	if (!fs.existsSync(filePath)) {
		return callback({ error: '文件不存在: ' + filePath });
	}
	
	try {
		var content = fs.readFileSync(filePath, 'utf8');
		var ext = path.extname(filePath).toLowerCase();
		var cwd = path.dirname(filePath);
		var dependencies = [];
		
		if (ext === '.py') {
			dependencies = this._parsePythonImports(content, cwd);
		} else if (['.js', '.ts', '.jsx', '.tsx', '.mjs'].includes(ext)) {
			dependencies = this._parseJsImports(content, filePath);
		}
		
		callback({
			path: filePath,
			dependencies: dependencies
		});
	} catch (e) {
		self._logger.error('解析依赖失败', { path: filePath, error: e.message });
		callback({ error: '解析依赖失败: ' + e.message });
	}
};

// 列出目录内容
PM2Listener.prototype.listDirectory = function(dirPath, callback) {
	var self = this;
	
	if (!fs.existsSync(dirPath)) {
		return callback({ error: '目录不存在: ' + dirPath });
	}
	
	try {
		var stat = fs.statSync(dirPath);
		if (!stat.isDirectory()) {
			return callback({ error: '不是目录: ' + dirPath });
		}
		
		var items = fs.readdirSync(dirPath).map(function(name) {
			var itemPath = path.join(dirPath, name);
			try {
				var itemStat = fs.statSync(itemPath);
				return {
					name: name,
					path: itemPath,
					isDirectory: itemStat.isDirectory(),
					size: itemStat.size,
					mtime: itemStat.mtime
				};
			} catch (e) {
				return null;
			}
		}).filter(function(item) {
			return item !== null;
		}).sort(function(a, b) {
			// 目录排在前面
			if (a.isDirectory && !b.isDirectory) return -1;
			if (!a.isDirectory && b.isDirectory) return 1;
			return a.name.localeCompare(b.name);
		});
		
		callback({
			path: dirPath,
			items: items
		});
	} catch (e) {
		self._logger.error('列出目录失败', { path: dirPath, error: e.message });
		callback({ error: '列出目录失败: ' + e.message });
	}
};

module.exports = PM2Listener;
