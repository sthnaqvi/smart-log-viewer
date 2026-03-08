/**
 * PM2 ecosystem config for Smart Log Viewer.
 * Use: pm2 start ecosystem.config.js
 * Or: pm2 install . (from project root)
 */

module.exports = {
  apps: [
    {
      name: 'smart-log-viewer',
      script: 'bin/smart-log-viewer.js',
      args: ['--no-open'],
      cwd: __dirname,
      env: {
        PORT: 3847,
      },
      env_production: {
        PORT: 3847,
      },
      merge_logs: true,
      max_memory_restart: '200M',
    },
  ],
};
