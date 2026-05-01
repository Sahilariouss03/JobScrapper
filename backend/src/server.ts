import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import jwt from 'jsonwebtoken';
import { initializeDatabase } from './database/db';
import { logger } from './utils/logger';
import { startPollingEngine } from './services/pollingEngine';
import profileRouter from './routes/profile';
import applicationsRouter from './routes/applications';
import jobsRouter from './routes/jobs';
import authRouter from './routes/auth';

const app = express();
const PORT = parseInt(process.env.PORT || '5000');

// ─── Strict CORS ──────────────────────────────────────────────
// Only the Vercel frontend URL (or localhost in dev) is allowed.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = [ALLOWED_ORIGIN, ...DEV_ORIGINS];
    if (allowed.includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked request from origin: ${origin}`);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ─── Body parsers ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded resumes statically (auth-protected in prod)
const UPLOADS_PATH = process.env.UPLOADS_PATH || './uploads';
app.use('/uploads', express.static(path.resolve(UPLOADS_PATH)));

// ─── JWT Auth Middleware ──────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_32_CHARS_MIN';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: no token provided' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string };
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

// ─── Routes ───────────────────────────────────────────────────
// Public: auth only
app.use('/api/auth', authRouter);

// Protected: all other API routes
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/applications', requireAuth, applicationsRouter);
app.use('/api/jobs', requireAuth, jobsRouter);

// Health check — public (used by Docker healthcheck + tunnel)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    headless: process.env.PLAYWRIGHT_HEADLESS,
  });
});

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err.message?.startsWith('CORS policy')) {
    res.status(403).json({ error: err.message });
    return;
  }
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Bootstrap ────────────────────────────────────────────────
async function bootstrap() {
  try {
    await initializeDatabase();

    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Backend running at http://0.0.0.0:${PORT}`);
      logger.info(`🔒 CORS restricted to: ${ALLOWED_ORIGIN}`);
      logger.info(`🎭 Playwright headless: ${process.env.PLAYWRIGHT_HEADLESS}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);
      const { stopPollingEngine } = await import('./services/pollingEngine');
      stopPollingEngine();
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    startPollingEngine();
    logger.info('✅ All systems operational');
  } catch (err: any) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

bootstrap();
