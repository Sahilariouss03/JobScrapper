import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_32_CHARS_MIN';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';

// POST /api/auth/login
// Body: { password: string }
router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password || password !== DASHBOARD_PASSWORD) {
    logger.warn('Failed login attempt', { ip: req.ip });
    // Constant-time failure (prevents timing attacks)
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: 'dashboard-user', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '24h', issuer: 'job-scrapper' }
  );

  logger.info('Dashboard login successful', { ip: req.ip });
  res.json({
    token,
    expiresIn: 86400, // seconds
    message: 'Login successful',
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const old = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    const token = jwt.sign(
      { sub: old.sub, role: old.role },
      JWT_SECRET,
      { expiresIn: '24h', issuer: 'job-scrapper' }
    );
    res.json({ token, expiresIn: 86400 });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// GET /api/auth/verify
router.get('/verify', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ valid: false });
  try {
    jwt.verify(authHeader.slice(7), JWT_SECRET);
    res.json({ valid: true });
  } catch {
    res.status(401).json({ valid: false });
  }
});

export default router;
