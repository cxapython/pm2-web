module.exports = {
  apps: [
    {
      name: 'crawler-download',
      script: 'crawler_download.py',
      interpreter: 'python3',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'crawler-api',
      script: 'crawler_api.py',
      interpreter: 'python3',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: 'crawler-webpage',
      script: 'crawler_webpage.py',
      interpreter: 'python3',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    }
  ]
};
