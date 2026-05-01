import { Router, Request, Response } from 'express';
import { db } from '../database/db';
import { triggerManualPoll, getEngineStatus } from '../services/pollingEngine';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { platform, status, search } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    let query = db('jobs').orderBy('scraped_at', 'desc');
    if (platform) query = query.where('platform', platform);
    if (status) query = query.where('status', status);
    if (search) query = query.where(b => b.whereLike('title', `%${search}%`).orWhereLike('company', `%${search}%`));

    const total = await query.clone().count('* as cnt').first() as any;
    const rows = await query.limit(limit).offset(offset);
    res.json({ jobs: rows.map((r: any) => ({ ...r, isRemote: !!r.is_remote, rawData: JSON.parse(r.raw_data || '{}') })), total: parseInt(total?.cnt) || 0, page, limit, pages: Math.ceil((parseInt(total?.cnt) || 0) / limit) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const rows = await db('activity_log as al')
      .leftJoin('jobs as j', 'j.id', 'al.job_id')
      .select('al.*', 'j.title', 'j.company', 'j.platform')
      .orderBy('al.created_at', 'desc').limit(limit);
    res.json(rows.map((r: any) => ({
      id: r.id, eventType: r.event_type, message: r.message, createdAt: r.created_at,
      metadata: JSON.parse(r.metadata || '{}'),
      job: r.title ? { title: r.title, company: r.company, platform: r.platform } : null,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/engine-status', (_req: Request, res: Response) => {
  res.json(getEngineStatus());
});

router.post('/trigger-poll', (_req: Request, res: Response) => {
  triggerManualPoll();
  res.json({ success: true, message: 'Manual poll triggered' });
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await db('jobs').where('id', req.params.id).first();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ ...row, isRemote: !!row.is_remote, rawData: JSON.parse(row.raw_data || '{}') });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/skip', async (req: Request, res: Response) => {
  try {
    await db('jobs').where('id', req.params.id).update({ status: 'skipped' });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
