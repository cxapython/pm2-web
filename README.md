# pm2-web

[![Node.js 25+](https://img.shields.io/badge/node-%3E%3D25.0.0-brightgreen)](https://nodejs.org/)
[![PM2 5.x](https://img.shields.io/badge/pm2-%3E%3D5.0.0-blue)](https://pm2.keymetrics.io/)

[PM2](https://github.com/Unitech/pm2) 进程管理器的 Web 监控界面。

![pm2-web 截图](https://raw.github.com/cxapython/pm2-web/master/assets/screenshot-1.0.png)

![在线编辑代码](https://raw.github.com/cxapython/pm2-web/master/assets/screenshot-0.0.png)

## 特性

- 🖥️ 实时监控 PM2 管理的所有进程
- 📊 显示 CPU、内存使用率和系统负载
- 🌐 **网络带宽监控** - 显示系统总带宽和各进程 I/O 速度
- 📈 **I/O 速度图表** - 实时展示进程的读写速度历史
- 🔄 支持停止、重启、重载进程
- 📝 实时日志输出查看
- ✏️ **在线代码编辑器** - 直接查看和编辑进程源代码
- 🔗 **依赖文件跳转** - 自动解析并跳转到本地依赖文件
- 🔒 支持 HTTP 基本认证
- 🔐 支持 HTTPS/SSL
- ⚡ WebSocket 实时数据更新

## 系统要求

- **Node.js** >= 18.0.0 (已测试支持 Node.js 25)
- **PM2** >= 5.0.0

## 安装

### 本地安装

```bash
git clone https://github.com/cxapython/pm2-web.git
cd pm2-web
npm install
```

## 使用方法

### 启动

```bash
node pm2-web.js
```

启动后访问 `http://localhost:9000` 即可查看 PM2 进程监控界面。

## 配置

pm2-web 会按以下顺序加载配置文件：

1. 命令行参数 `--config /path/to/config.json`
2. 用户配置文件 `~/.config/pm2-web/config.json`
3. 全局配置文件 `/etc/pm2-web/config.json`

### 配置文件示例

```json
{
  "www": {
    "host": "localhost",
    "address": "0.0.0.0",
    "port": 9000,
    "authentication": {
      "enabled": false,
      "username": "admin",
      "password": "password"
    },
    "ssl": {
      "enabled": false,
      "port": 9001,
      "key": "/path/to/key.pem",
      "certificate": "/path/to/cert.pem"
    }
  },
  "updateFrequency": 5000,
  "logs": {
    "max": 1000
  }
}
```

### 常用配置选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `www:port` | HTTP 服务端口 | 9000 |
| `www:address` | 绑定地址 | 0.0.0.0 |
| `www:authentication:enabled` | 启用 HTTP 基本认证 | false |
| `www:ssl:enabled` | 启用 HTTPS | false |
| `updateFrequency` | 数据刷新频率（毫秒） | 5000 |
| `logs:max` | 每个进程保留的最大日志行数 | 1000 |

### 命令行参数

所有配置选项都可以通过命令行传递：

```bash
pm2-web --www:port 8080 --www:authentication:enabled true
```

## HTTP 认证

启用 HTTP 基本认证：

```json
{
  "www": {
    "authentication": {
      "enabled": true,
      "username": "your_username",
      "password": "your_password"
    }
  }
}
```

⚠️ **注意**：密码以明文传输，建议同时启用 SSL。

## SSL/HTTPS 支持

1. 生成证书（如果没有）：

```bash
cd certs
./generate_certificate.sh
```

2. 配置 SSL：

```json
{
  "www": {
    "ssl": {
      "enabled": true,
      "port": 9001,
      "passphrase": "your_passphrase",
      "key": "/path/to/server.key",
      "certificate": "/path/to/server.crt"
    }
  }
}
```

## 进程管理

在 Web 界面中可以对每个进程执行以下操作：

- **停止 (Stop)**: 停止进程
- **重启 (Restart)**: 停止并重新启动进程（会断开连接）
- **重载 (Reload)**: 优雅重载（零停机时间）
- **编辑代码**: 打开在线代码编辑器

## 在线代码编辑

pm2-web 提供了强大的在线代码编辑功能，让您可以直接在浏览器中查看和修改运行中进程的源代码。

### 功能特性

- 🎨 **Monaco Editor** - 使用 VS Code 同款编辑器，支持语法高亮
- 💾 **实时保存** - Ctrl+S 快捷键保存，自动创建备份
- 🔄 **保存并重启** - 一键保存代码并重启进程
- 📁 **文件浏览器** - 浏览项目目录结构
- 🔗 **依赖跳转** - 自动解析 Python/Node.js 的本地导入，点击跳转编辑
- 📜 **编辑历史** - 支持返回之前编辑的文件

### 使用方法

1. 在进程列表中点击 **编辑代码** 按钮（代码图标）
2. 编辑器会自动加载进程的主脚本文件
3. 右侧显示该文件的本地依赖，点击可跳转编辑
4. 修改代码后，点击 **保存** 或 **保存并重启**

### 支持的文件类型

- Python: `.py`
- JavaScript/TypeScript: `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`
- JSON: `.json`
- YAML: `.yaml`, `.yml`
- Shell: `.sh`, `.bash`
- 其他: `.html`, `.css`, `.md`, `.txt` 等

### 依赖解析

**Python 文件**:
- 解析 `import xxx` 和 `from xxx import yyy` 语句
- 自动查找本地模块文件

**Node.js 文件**:
- 解析 `require('xxx')` 和 `import xxx from 'xxx'` 语句
- 只显示相对路径的本地依赖（以 `.` 开头）

### 安全说明

- 只允许编辑特定类型的源代码文件
- 每次保存自动创建 `.backup.{timestamp}` 备份文件
- 文件大小限制为 5MB

### 软重载 vs 硬重载

默认使用软重载，PM2 会先发送 `shutdown` 消息，等待进程清理资源后再终止。

要使用硬重载（立即终止），在配置中设置：

```json
{
  "forceHardReload": true
}
```

监听 shutdown 消息：

```javascript
process.on("message", function(message) {
  if (message === "shutdown") {
    // 清理资源（关闭数据库连接等）
    cleanup();
    process.exit(0);
  }
});
```

## 网络带宽监控

pm2-web 提供了实时的网络带宽监控功能，特别适合监控爬虫等网络密集型应用。

### 功能特性

- 📊 **系统级网络监控**
  - 实时显示系统总下载/上传速度
  - 累计流量统计
  - 支持多网卡

- 📈 **进程级 I/O 监控**
  - 每个进程的读取/写入 I/O 速度
  - I/O 历史数据图表
  - 适合监控爬虫、数据处理等 I/O 密集型应用

### 平台支持

| 功能 | Linux | macOS |
|------|-------|-------|
| 系统网络速度 | ✅ | ✅ |
| 进程 I/O 速度 | ✅ 完整支持 | ⚠️ 有限支持 |

**注意**：
- Linux 上通过读取 `/proc/net/dev` 和 `/proc/[pid]/io` 获取精确数据
- macOS 上系统网络统计通过 `netstat` 获取，进程级 I/O 功能有限

### 显示位置

1. **系统信息区域**：显示整体网络带宽（下载/上传速度，总流量）
2. **进程列表**：每个进程显示 I/O 读写速度
3. **详情图表**：展开进程详情可看到 CPU、内存、I/O 的历史图表

## 图表配置

资源使用图表支持自定义数据点数量和时间分布：

```json
{
  "graph": {
    "datapoints": 1000,
    "distribution": [40, 25, 10, 10, 5]
  }
}
```

- `datapoints`: 图表显示的最大数据点数
- `distribution`: 按天分布比例，数组第一项是今天的数据占比

## 调试进程

要调试运行中的进程，需要在进程启动时指定调试端口：

```bash
pm2 start --node-args="--inspect=9229" app.js
```

然后在配置中指定 inspector 端口：

```json
{
  "pm2": [{
    "host": "localhost",
    "inspector": 9229
  }]
}
```

## 版本历史

### 3.2.0 (2026)

- ✨ 新增系统网络带宽监控（下载/上传速度）
- ✨ 新增进程级 I/O 速度监控
- ✨ 新增 I/O 历史数据图表展示
- ✨ 支持 Linux 和 macOS 平台
- 🔧 优化资源监控图表，支持多数据源展示

### 3.1.0 (2026)

- ✨ 新增在线代码编辑器功能
- ✨ 支持 Monaco Editor（VS Code 同款编辑器）
- ✨ 支持保存代码并一键重启进程
- ✨ 自动解析 Python/Node.js 本地依赖并支持跳转编辑
- ✨ 支持文件浏览器浏览项目目录
- ✨ 自动创建文件备份
- 🔧 修复 html-entities API 兼容性问题
- 🔧 修复 Angular $apply 重复调用问题

### 3.0.0 (2026)

- 🎉 支持 Node.js 25
- ⬆️ 升级 Express 4.x
- ⬆️ 升级 ws 8.x
- ⬆️ 升级 winston 3.x
- ⬆️ 使用 pug 替换 jade
- ⬆️ 使用 PM2 programmatic API 替换已废弃的 pm2-interface
- 🔧 修复多个兼容性问题

### 2.0.x

- 使用 pm2-interface 2.x 版本

### 1.x.x

- 初始版本
- 进程列表、启停重启
- 资源使用图表
- 日志查看
- HTTP 认证和 SSL 支持

## 开发

```bash
# 安装依赖
npm install

# 开发模式运行（自动重启）
npm run dev

# 运行测试
npm test
```

## 贡献

欢迎提交 Pull Request！请确保：

1. 代码通过测试
2. 遵循现有代码风格
3. 更新相关文档

## 许可证

MIT License

## 致谢

- 原作者 [achingbrain](http://github.com/achingbrain)
- [PM2](https://github.com/unitech/pm2) 团队
- [reconnecting-websocket](https://github.com/joewalnes/reconnecting-websocket) by [joewalnes](https://github.com/joewalnes)
