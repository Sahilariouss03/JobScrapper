# Job Scrapper — Local Automation Daemon

## Quick Start

### Dev Mode
```bash
# Backend
cd backend && cp .env.example .env && npm run dev

# Frontend (new terminal)
cd frontend && cp .env.example .env && npm run dev
# Open http://localhost:5173
```

### Docker (Production Daemon)
```bash
cd backend
cp .env.example .env   # fill in all values
docker compose up -d   # starts backend + cloudflare tunnel
docker compose logs -f backend
```

### PM2 Fallback
```bash
cd backend
npm run build
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup
```

## Architecture

```
Vercel (Public Dashboard)
  └── React SPA (Login-protected, JWT auth)
        |
        | HTTPS via Cloudflare Tunnel
        v
Local Machine (Your PC — always on via Docker/PM2)
  ├── Express API  (port 5000, CORS = Vercel URL only)
  ├── Playwright Engine  (headless Chromium, headless=true enforced)
  │     ├── LinkedIn scraper
  │     ├── Indeed scraper
  │     ├── Naukri scraper
  │     └── Auto-applier (form fill + resume upload)
  ├── Nodemailer  (Gmail SMTP → intervention alerts)
  ├── Cron Engine  (every 15 min)
  └── SQLite DB   (your data NEVER leaves your machine)
```

## Database Schema Summary

**user_profile** — single row (id='default'), stores all personal info as JSON fields  
**jobs** — UNIQUE(platform, external_id) prevents duplicate processing  
**applications** — tracks status lifecycle, intervention flags  
**scraping_sessions** — audit log per cron cycle  
**activity_log** — full event stream  

## Key Env Vars

| Var | Purpose |
|---|---|
| `ALLOWED_ORIGIN` | Vercel URL — only origin allowed by CORS |
| `JWT_SECRET` | Signs dashboard login tokens (24h expiry) |
| `DASHBOARD_PASSWORD` | Your login password |
| `CLOUDFLARE_TUNNEL_TOKEN` | From `cloudflared tunnel token job-scrapper` |
| `SMTP_USER / SMTP_PASS` | Gmail + App Password |
| `PLAYWRIGHT_HEADLESS` | Auto-set to `true` by Dockerfile |

## Cloudflare Tunnel Setup
```bash
# Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login
cloudflared tunnel create job-scrapper
# Copy the printed token into .env as CLOUDFLARE_TUNNEL_TOKEN
# Then: docker compose up -d
```

## Deploy Frontend to Vercel
```bash
cd frontend
# Set VITE_API_URL=https://your-tunnel-subdomain.trycloudflare.com in .env
vercel --prod
# After deploy: set ALLOWED_ORIGIN=https://your-app.vercel.app in backend .env
# docker compose restart backend
```
