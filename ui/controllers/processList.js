
module.exports = ["$scope", "$routeParams", "$location", "$window", "$timeout", "hostList", "webSocketResponder", function($scope, $routeParams, $location, $window, $timeout, hostList, webSocketResponder) {
	$scope.showDetails = {};
	
	// 代码编辑器相关状态
	$scope.codeEditor = {
		visible: false,
		loading: false,
		saving: false,
		currentFile: null,
		originalContent: '',
		content: '',
		modified: false,
		process: null,
		dependencies: [],
		fileHistory: [], // 文件浏览历史
		currentDir: null,
		dirItems: [],
		showFileBrowser: false,
		message: null,
		messageType: 'info',
		editor: null // Monaco editor instance
	};

	var updateScope = function() {
		var hostData = hostList.find($routeParams.host);

		if(!hostData) {
			console.warn("Could not load host data for", $routeParams.host);

			return $location.path("/");
		}

		$scope.hostData = hostData;
		$scope.processes = hostData.processes;
		$scope.debugEnabled = hostData.inspector ? true : false;

		$scope.toggleDetails = function(pm_id) {
			$scope.showDetails[pm_id] = !$scope.showDetails[pm_id];
		};

		$scope.start = function(pm_id, $event) {
			$event.stopPropagation();

			webSocketResponder.startProcess(hostData.name, pm_id);
		};
		$scope.stop = function(pm_id, $event) {
			$event.stopPropagation();

			webSocketResponder.stopProcess(hostData.name, pm_id);
		};
		$scope.restart = function(pm_id, $event) {
			$event.stopPropagation();

			webSocketResponder.restartProcess(hostData.name, pm_id);
		};
		$scope.reload = function(process, $event) {
			$event.stopPropagation();

			process.reloading = true;

			webSocketResponder.reloadProcess(hostData.name, process.id);
		};
		$scope.debug = function(process, $event) {
			$event.stopPropagation();

			webSocketResponder.debugProcess(hostData.name, process.id);

			$window.open("http://" + hostData.name + ":" + hostData.inspector + "/debug?port=" + process.debugPort, hostData.name + "-" + process.id, "location=no,menubar=no,status=no,toolbar=no");
		};
		$scope.clearLogs = function(process) {
			process.logs.length = 0;
		};
		
		// 编辑代码
		$scope.editCode = function(process, $event) {
			$event.stopPropagation();
			
			$scope.codeEditor.visible = true;
			$scope.codeEditor.loading = true;
			$scope.codeEditor.process = process;
			$scope.codeEditor.message = null;
			$scope.codeEditor.fileHistory = [];
			
			// 请求进程脚本信息
			webSocketResponder.getProcessScript(hostData.name, process.id);
		};
		
		// 关闭编辑器
		$scope.closeCodeEditor = function() {
			if ($scope.codeEditor.modified) {
				if (!confirm('您有未保存的更改，确定要关闭吗？')) {
					return;
				}
			}
			
			$scope.codeEditor.visible = false;
			$scope.codeEditor.currentFile = null;
			$scope.codeEditor.content = '';
			$scope.codeEditor.originalContent = '';
			$scope.codeEditor.modified = false;
			$scope.codeEditor.dependencies = [];
			$scope.codeEditor.fileHistory = [];
			$scope.codeEditor.showFileBrowser = false;
			
			if ($scope.codeEditor.editor) {
				$scope.codeEditor.editor.dispose();
				$scope.codeEditor.editor = null;
			}
		};
		
		// 打开文件
		$scope.openFile = function(filePath) {
			$scope.codeEditor.loading = true;
			$scope.codeEditor.message = null;
			
			// 保存当前文件到历史
			if ($scope.codeEditor.currentFile && $scope.codeEditor.currentFile !== filePath) {
				var historyIndex = $scope.codeEditor.fileHistory.indexOf($scope.codeEditor.currentFile);
				if (historyIndex === -1) {
					$scope.codeEditor.fileHistory.push($scope.codeEditor.currentFile);
				}
			}
			
			webSocketResponder.readFile(filePath);
		};
		
		// 返回上一个文件
		$scope.goBackFile = function() {
			if ($scope.codeEditor.fileHistory.length > 0) {
				var prevFile = $scope.codeEditor.fileHistory.pop();
				$scope.openFile(prevFile);
			}
		};
		
		// 保存文件
		$scope.saveFile = function() {
			if (!$scope.codeEditor.currentFile) return;
			
			$scope.codeEditor.saving = true;
			$scope.codeEditor.message = null;
			
			// 获取编辑器内容
			var content = $scope.codeEditor.content;
			if ($scope.codeEditor.editor) {
				content = $scope.codeEditor.editor.getValue();
			}
			
			webSocketResponder.saveFile($scope.codeEditor.currentFile, content);
		};
		
		// 保存并重启
		$scope.saveAndRestart = function() {
			if (!$scope.codeEditor.currentFile || !$scope.codeEditor.process) return;
			
			$scope.codeEditor.saving = true;
			$scope.codeEditor.message = null;
			$scope.codeEditor._restartAfterSave = true;
			
			var content = $scope.codeEditor.content;
			if ($scope.codeEditor.editor) {
				content = $scope.codeEditor.editor.getValue();
			}
			
			webSocketResponder.saveFile($scope.codeEditor.currentFile, content);
		};
		
		// 刷新依赖
		$scope.refreshDependencies = function() {
			if ($scope.codeEditor.currentFile) {
				webSocketResponder.getFileDependencies($scope.codeEditor.currentFile);
			}
		};
		
		// 切换文件浏览器
		$scope.toggleFileBrowser = function() {
			$scope.codeEditor.showFileBrowser = !$scope.codeEditor.showFileBrowser;
			
			if ($scope.codeEditor.showFileBrowser && $scope.codeEditor.currentFile) {
				var dirPath = $scope.codeEditor.currentFile.substring(0, $scope.codeEditor.currentFile.lastIndexOf('/'));
				$scope.codeEditor.currentDir = dirPath;
				webSocketResponder.listDirectory(dirPath);
			}
		};
		
		// 导航到目录
		$scope.navigateToDir = function(dirPath) {
			$scope.codeEditor.currentDir = dirPath;
			webSocketResponder.listDirectory(dirPath);
		};
		
		// 导航到上级目录
		$scope.navigateUp = function() {
			if ($scope.codeEditor.currentDir) {
				var parentDir = $scope.codeEditor.currentDir.substring(0, $scope.codeEditor.currentDir.lastIndexOf('/'));
				if (parentDir) {
					$scope.navigateToDir(parentDir);
				}
			}
		};
		
		// 点击文件浏览器项目
		$scope.clickBrowserItem = function(item) {
			if (item.isDirectory) {
				$scope.navigateToDir(item.path);
			} else {
				$scope.openFile(item.path);
				$scope.codeEditor.showFileBrowser = false;
			}
		};
		
		// 获取文件图标
		$scope.getFileIcon = function(filename) {
			var ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
			var iconMap = {
				'py': 'icon-file-text',
				'js': 'icon-file-text',
				'ts': 'icon-file-text',
				'json': 'icon-file-text',
				'md': 'icon-file-text',
				'txt': 'icon-file-text',
				'html': 'icon-file-text',
				'css': 'icon-file-text',
				'sh': 'icon-file-text'
			};
			return iconMap[ext] || 'icon-file';
		};
		
		// 获取语言类型 (for Monaco Editor)
		$scope.getLanguage = function(filename) {
			if (!filename) return 'plaintext';
			var ext = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
			var langMap = {
				'py': 'python',
				'js': 'javascript',
				'ts': 'typescript',
				'jsx': 'javascript',
				'tsx': 'typescript',
				'json': 'json',
				'md': 'markdown',
				'html': 'html',
				'css': 'css',
				'sh': 'shell',
				'bash': 'shell',
				'yaml': 'yaml',
				'yml': 'yaml',
				'xml': 'xml',
				'sql': 'sql',
				'rb': 'ruby',
				'php': 'php',
				'go': 'go',
				'rs': 'rust',
				'java': 'java',
				'c': 'c',
				'cpp': 'cpp',
				'h': 'c'
			};
			return langMap[ext] || 'plaintext';
		};
		
		// 初始化 Monaco Editor
		$scope.initMonacoEditor = function() {
			if (typeof monaco === 'undefined') {
				console.warn('Monaco Editor not loaded');
				return;
			}
			
			var container = document.getElementById('monaco-editor-container');
			if (!container) return;
			
			if ($scope.codeEditor.editor) {
				$scope.codeEditor.editor.dispose();
			}
			
			var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'vs-dark' : 'vs';
			
			$scope.codeEditor.editor = monaco.editor.create(container, {
				value: $scope.codeEditor.content,
				language: $scope.getLanguage($scope.codeEditor.currentFile),
				theme: theme,
				automaticLayout: true,
				fontSize: 14,
				lineNumbers: 'on',
				minimap: { enabled: true },
				scrollBeyondLastLine: false,
				wordWrap: 'on',
				tabSize: 4,
				insertSpaces: false,
				renderWhitespace: 'selection'
			});
			
			// 监听内容变化
			$scope.codeEditor.editor.onDidChangeModelContent(function() {
				$scope.$apply(function() {
					$scope.codeEditor.content = $scope.codeEditor.editor.getValue();
					$scope.codeEditor.modified = $scope.codeEditor.content !== $scope.codeEditor.originalContent;
				});
			});
			
			// Ctrl+S 保存快捷键
			$scope.codeEditor.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
				$scope.$apply(function() {
					$scope.saveFile();
				});
			});
		};
	};
	updateScope();

	hostList.on("update", function(hostName) {
		// only update scope if the update was for our host
		if(hostName == $routeParams.host) {
			updateScope();
		}
	});
	
	// 安全的 $apply 封装，避免 $apply already in progress 错误
	var safeApply = function(fn) {
		var phase = $scope.$root.$$phase;
		if (phase === '$apply' || phase === '$digest') {
			if (fn && typeof fn === 'function') {
				fn();
			}
		} else {
			$scope.$apply(fn);
		}
	};
	
	// 监听 WebSocket 事件
	webSocketResponder.on("processScript", function(result) {
		safeApply(function() {
			if (result.error) {
				$scope.codeEditor.loading = false;
				$scope.codeEditor.message = result.error;
				$scope.codeEditor.messageType = 'error';
				return;
			}
			
			// 获取脚本文件内容
			webSocketResponder.readFile(result.script);
		});
	});
	
	webSocketResponder.on("fileContent", function(result) {
		safeApply(function() {
			$scope.codeEditor.loading = false;
			
			if (result.error) {
				$scope.codeEditor.message = result.error;
				$scope.codeEditor.messageType = 'error';
				return;
			}
			
			$scope.codeEditor.currentFile = result.path;
			$scope.codeEditor.content = result.content;
			$scope.codeEditor.originalContent = result.content;
			$scope.codeEditor.modified = false;
			
			// 初始化 Monaco Editor
			$timeout(function() {
				$scope.initMonacoEditor();
			}, 100);
			
			// 获取依赖
			webSocketResponder.getFileDependencies(result.path);
		});
	});
	
	webSocketResponder.on("fileSaved", function(result) {
		safeApply(function() {
			$scope.codeEditor.saving = false;
			
			if (result.error) {
				$scope.codeEditor.message = result.error;
				$scope.codeEditor.messageType = 'error';
				return;
			}
			
			$scope.codeEditor.message = '文件保存成功！';
			$scope.codeEditor.messageType = 'success';
			$scope.codeEditor.originalContent = $scope.codeEditor.content;
			$scope.codeEditor.modified = false;
			
			// 如果需要重启
			if ($scope.codeEditor._restartAfterSave && $scope.codeEditor.process) {
				$scope.codeEditor._restartAfterSave = false;
				webSocketResponder.restartProcess($scope.hostData.name, $scope.codeEditor.process.id);
				$scope.codeEditor.message = '文件已保存，进程正在重启...';
			}
			
			// 3秒后清除消息
			$timeout(function() {
				if ($scope.codeEditor.messageType === 'success') {
					$scope.codeEditor.message = null;
				}
			}, 3000);
		});
	});
	
	webSocketResponder.on("fileDependencies", function(result) {
		safeApply(function() {
			if (result.error) {
				console.warn('获取依赖失败:', result.error);
				return;
			}
			
			$scope.codeEditor.dependencies = result.dependencies || [];
		});
	});
	
	webSocketResponder.on("directoryList", function(result) {
		safeApply(function() {
			if (result.error) {
				console.warn('获取目录列表失败:', result.error);
				return;
			}
			
			$scope.codeEditor.currentDir = result.path;
			$scope.codeEditor.dirItems = result.items || [];
		});
	});
}];
