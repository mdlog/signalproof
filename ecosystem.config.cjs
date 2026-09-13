/**
 * pm2 process file for the public host.
 *
 *   pnpm build && pm2 start ecosystem.config.cjs && pm2 save
 *
 * One process: the Express server, the buyer API and the proof worker share it
 * (the worker must not run twice — two workers race on the relayer nonces).
 * `.env` is read by dotenv from `cwd`, so the file lives in the repo root; PORT
 * here is what the Cloudflare tunnel points at. In production a busy port is
 * fatal (see server/_core/index.ts), so pm2 backs off and retries instead of
 * the app quietly moving to a port nothing routes to.
 */
module.exports = {
  apps: [
    {
      name: "signalproof",
      cwd: __dirname,
      script: "dist/index.js",
      env: { NODE_ENV: "production", PORT: "3011" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      exp_backoff_restart_delay: 500,
      max_restarts: 50,
      max_memory_restart: "700M",
      kill_timeout: 10000,
      time: true,
      merge_logs: true,
    },
  ],
};
