/**
 * PM2 Ecosystem Config — Fallback daemon if not using Docker
 * Usage:
 *   npm run build
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup   ← auto-start on reboot
 */
module.exports = {
  apps: [
    {
      name: 'job-scrapper-backend',
      script: './dist/server.js',
      cwd: __dirname,
      instances: 1,            // single instance — scraper is stateful
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      env: {
        NODE_ENV: 'development',
        PORT: 5000,
        PLAYWRIGHT_HEADLESS: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        PLAYWRIGHT_HEADLESS: 'true',
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,

      // Graceful restart
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
  ],
};
