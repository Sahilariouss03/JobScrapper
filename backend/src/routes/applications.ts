import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { sendStatusUpdateEmail } from '../services/emailService';
import { ApplicationStatus } from '../types';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/applications?page=1&limit=20&status=applied
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const offset = (page - 1) * limit;

    let query = db('applications as a')
      .join('jobs as j', 'j.id', 'a.job_id')
      .select('a.*', 'j.title', 'j.company', 'j.platform', 'j.location',
              'j.apply_url', 'j.is_remote', 'j.posted_at', 'j.match_score', 'j.job_url')
      .orderBy('a.applied_at', 'desc');

    if (status) query = query.where('a.status', status);
    const total = await query.clone().count('* as cnt').first() as any;
    const rows = await query.limit(limit).offset(offset);

    res.json({
      applications: rows.map((r: any) => ({
        id: r.id, jobId: r.job_id, status: r.status, appliedAt: r.applied_at,
        statusUpdatedAt: r.status_updated_at, coverLetter: r.cover_letter,
        notes: r.notes, interviewDate: r.interview_date, interviewType: r.interview_type,
        salaryOffered: r.salary_offered, appliedBy: r.applied_by,
        interventionRequired: !!r.intervention_required, interventionReason: r.intervention_reason,
        answersUsed: JSON.parse(r.answers_used || '{}'),
        job: { title: r.title, company: r.company, platform: r.platform, location: r.location, applyUrl: r.apply_url, jobUrl: r.job_url, isRemote: !!r.is_remote, matchScore: r.match_score, postedAt: r.posted_at },
      })),
      total: parseInt(total?.cnt) || 0, page, limit,
      pages: Math.ceil((parseInt(total?.cnt) || 0) / limit),
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/applications/metrics
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const rows = await db('applications')
      .select(
        db.raw(`COUNT(CASE WHEN status IN ('applied','in_consideration','interview_scheduled','offer_received') THEN 1 END) as total_applied`),
        db.raw(`COUNT(CASE WHEN status = 'in_consideration' THEN 1 END) as in_consideration`),
        db.raw(`COUNT(CASE WHEN status = 'interview_scheduled' THEN 1 END) as interviews_scheduled`),
        db.raw(`COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected`),
        db.raw(`COUNT(CASE WHEN status = 'offer_received' THEN 1 END) as offers_received`),
        db.raw(`COUNT(CASE WHEN intervention_required = 1 THEN 1 END) as interventions_required`),
        db.raw(`COUNT(CASE WHEN date(applied_at) = date('now') THEN 1 END) as today_applied`)
      ).first() as any;

    res.json({
      totalApplied: rows.total_applied || 0,
      inConsideration: rows.in_consideration || 0,
      interviewsScheduled: rows.interviews_scheduled || 0,
      rejected: rows.rejected || 0,
      offersReceived: rows.offers_received || 0,
      interventionsRequired: rows.interventions_required || 0,
      todayApplied: rows.today_applied || 0,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/applications/recent?limit=10
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const rows = await db('applications as a')
      .join('jobs as j', 'j.id', 'a.job_id')
      .select('a.id', 'a.status', 'a.applied_at', 'a.intervention_required', 'a.applied_by',
              'j.title', 'j.company', 'j.platform', 'j.location', 'j.apply_url', 'j.match_score')
      .orderBy('a.applied_at', 'desc').limit(limit);

    res.json(rows.map((r: any) => ({
      id: r.id, status: r.status, appliedAt: r.applied_at,
      interventionRequired: !!r.intervention_required, appliedBy: r.applied_by,
      job: { title: r.title, company: r.company, platform: r.platform, location: r.location, applyUrl: r.apply_url, matchScore: r.match_score },
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/applications/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, notes, interviewDate, interviewType, salaryOffered } = req.body;
  const valid: ApplicationStatus[] = ['applied','in_consideration','interview_scheduled','offer_received','rejected','withdrawn'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const existing = await db('applications as a')
      .join('jobs as j', 'j.id', 'a.job_id')
      .select('a.status as old_status', 'j.title', 'j.company')
      .where('a.id', id).first();
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await db('applications').where('id', id).update({
      status, status_updated_at: new Date().toISOString(),
      ...(notes ? { notes } : {}),
      ...(interviewDate ? { interview_date: interviewDate } : {}),
      ...(interviewType ? { interview_type: interviewType } : {}),
      ...(salaryOffered ? { salary_offered: salaryOffered } : {}),
    });

    await db('activity_log').insert({
      id: uuidv4(), event_type: 'status_changed',
      message: `Status: ${existing.title} at ${existing.company}: ${existing.old_status} → ${status}`,
      created_at: new Date().toISOString(),
    });

    if (existing.old_status !== status) {
      sendStatusUpdateEmail(existing.title, existing.company, existing.old_status, status).catch(() => {});
    }

    logger.info(`Application ${id} → ${status}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
