module.exports = {
  apps: [{
    name: 'pm2-web',
    script: 'pm2-web.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
