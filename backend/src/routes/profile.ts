import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../database/db';
import { logger } from '../utils/logger';

const router = Router();
const UPLOAD_DIR = process.env.UPLOADS_PATH || './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `resume_${Date.now()}${path.extname(file.originalname)}`),
  }),
  fileFilter: (_req, file, cb) =>
    file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files allowed')),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// GET /api/profile
router.get('/', async (_req: Request, res: Response) => {
  try {
    const row = await db('user_profile').where('id', 'default').first();
    if (!row) return res.json({ isSetupComplete: false });
    const p = {
      ...row,
      education: JSON.parse(row.education || '[]'),
      experience: JSON.parse(row.experience || '[]'),
      skills: JSON.parse(row.skills || '[]'),
      certifications: JSON.parse(row.certifications || '[]'),
      targetRoles: JSON.parse(row.target_roles || '[]'),
      preferredLocations: JSON.parse(row.preferred_locations || '[]'),
      preferredJobTypes: JSON.parse(row.preferred_job_types || '[]'),
      isSetupComplete: !!row.is_setup_complete,
      fullName: row.full_name, linkedinUrl: row.linkedin_url,
      githubUrl: row.github_url, portfolioUrl: row.portfolio_url,
      resumePath: row.resume_path, resumeName: row.resume_name,
      alertEmail: row.alert_email, remotePreference: row.remote_preference,
      minSalary: row.min_salary, maxSalary: row.max_salary,
    };
    delete p.smtp_pass;
    res.json(p);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/profile
router.post('/', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    const body = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body;
    const resumePath = req.file ? path.resolve(req.file.path) : body.resumePath;
    const resumeName = req.file ? req.file.originalname : body.resumeName;
    const existing = await db('user_profile').where('id', 'default').first();

    const payload = {
      id: 'default',
      full_name: body.fullName, email: body.email, phone: body.phone || null,
      location: body.location || null, linkedin_url: body.linkedinUrl || null,
      github_url: body.githubUrl || null, portfolio_url: body.portfolioUrl || null,
      headline: body.headline || null, summary: body.summary || null,
      education: JSON.stringify(body.education || []),
      experience: JSON.stringify(body.experience || []),
      skills: JSON.stringify(body.skills || []),
      certifications: JSON.stringify(body.certifications || []),
      resume_path: resumePath || null, resume_name: resumeName || null,
      target_roles: JSON.stringify(body.targetRoles || []),
      preferred_locations: JSON.stringify(body.preferredLocations || []),
      preferred_job_types: JSON.stringify(body.preferredJobTypes || ['Full-time']),
      min_salary: body.minSalary || null, max_salary: body.maxSalary || null,
      remote_preference: body.remotePreference || 'Any',
      alert_email: body.alertEmail || null,
      smtp_host: body.smtpHost || null, smtp_port: body.smtpPort || null,
      smtp_user: body.smtpUser || null,
      ...(body.smtpPass ? { smtp_pass: body.smtpPass } : {}),
      is_setup_complete: 1,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await db('user_profile').where('id', 'default').update(payload);
    } else {
      await db('user_profile').insert({ ...payload, created_at: new Date().toISOString() });
    }

    logger.info(`Profile ${existing ? 'updated' : 'created'}`);
    res.json({ success: true, message: 'Profile saved successfully' });
  } catch (err: any) {
    logger.error('Profile save error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
