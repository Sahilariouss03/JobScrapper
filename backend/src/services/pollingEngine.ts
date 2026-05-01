import { CronJob } from 'cron';
import { chromium, Browser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/db';
import { scrapeLinkedIn, scrapeIndeed, scrapeNaukri, autoApplyJob } from './scraperService';
import { logger } from '../utils/logger';
import { Job, UserProfile, Platform } from '../types';

let browser: Browser | null = null;
let pollingJob: CronJob | null = null;
let isRunning = false;

// ─── Score a job against user preferences ────────────────────
function scoreJob(job: Omit<Job, 'id'|'scrapedAt'|'status'|'matchScore'>, profile: UserProfile): number {
  let score = 0;
  const titleLower = job.title.toLowerCase();
  const descLower = (job.description || '').toLowerCase();
  for (const role of profile.targetRoles) if (titleLower.includes(role.toLowerCase())) score += 40;
  for (const skill of profile.skills) if (descLower.includes(skill.toLowerCase())) score += 3;
  for (const loc of profile.preferredLocations) if ((job.location || '').toLowerCase().includes(loc.toLowerCase())) score += 15;
  if (profile.remotePreference === 'Remote' && job.isRemote) score += 20;
  return Math.min(100, score);
}

// ─── Persist scraped jobs ─────────────────────────────────────
async function persistJobs(
  rawJobs: Omit<Job, 'id'|'scrapedAt'|'status'|'matchScore'>[],
  profile: UserProfile
): Promise<Job[]> {
  const newJobs: Job[] = [];
  for (const j of rawJobs) {
    if (!j.externalId || !j.applyUrl || !j.title) continue;
    const score = scoreJob(j, profile);
    if (score < 20) continue;

    // Check if already exists
    const existing = await db('jobs').where({ platform: j.platform, external_id: j.externalId }).first();
    if (existing) continue;

    const id = uuidv4();
    await db('jobs').insert({
      id, external_id: j.externalId, platform: j.platform, title: j.title,
      company: j.company, location: j.location || null, apply_url: j.applyUrl,
      job_url: j.jobUrl || null, is_remote: j.isRemote ? 1 : 0,
      posted_at: j.postedAt || null, salary_currency: j.salaryCurrency,
      status: 'new', match_score: score, raw_data: JSON.stringify(j.rawData),
      scraped_at: new Date().toISOString(),
    });

    await db('activity_log').insert({
      id: uuidv4(), event_type: 'job_scraped', job_id: id,
      message: `Scraped: ${j.title} at ${j.company} [${j.platform}]`,
      created_at: new Date().toISOString(),
    });

    newJobs.push({ ...j, id, scrapedAt: new Date().toISOString(), status: 'new', matchScore: score });
  }
  logger.info(`Persisted ${newJobs.length} new jobs out of ${rawJobs.length} scraped`);
  return newJobs;
}

// ─── Queue new jobs for applying ─────────────────────────────
async function queueJobsForApply(jobs: Job[]): Promise<Job[]> {
  const eligible = jobs.filter(j => j.matchScore >= 40);
  for (const j of eligible) {
    await db('applications').insert({
      id: uuidv4(), job_id: j.id, status: 'applied', applied_by: 'auto',
      applied_at: new Date().toISOString(), status_updated_at: new Date().toISOString(),
      answers_used: '{}',
    }).onConflict('job_id').ignore();
    await db('jobs').where('id', j.id).update({ status: 'queued' });
  }
  return eligible;
}

// ─── Load profile from DB ─────────────────────────────────────
async function loadProfile(): Promise<UserProfile | null> {
  const row = await db('user_profile').where('id', 'default').first();
  if (!row || !row.is_setup_complete) return null;
  return {
    id: row.id, fullName: row.full_name, email: row.email, phone: row.phone,
    location: row.location, linkedinUrl: row.linkedin_url, githubUrl: row.github_url,
    portfolioUrl: row.portfolio_url, headline: row.headline, summary: row.summary,
    education: JSON.parse(row.education || '[]'),
    experience: JSON.parse(row.experience || '[]'),
    skills: JSON.parse(row.skills || '[]'),
    certifications: JSON.parse(row.certifications || '[]'),
    resumePath: row.resume_path, resumeName: row.resume_name,
    targetRoles: JSON.parse(row.target_roles || '[]'),
    preferredLocations: JSON.parse(row.preferred_locations || '[]'),
    preferredJobTypes: JSON.parse(row.preferred_job_types || '["Full-time"]'),
    minSalary: row.min_salary, maxSalary: row.max_salary,
    remotePreference: row.remote_preference, alertEmail: row.alert_email,
    smtpHost: row.smtp_host, smtpPort: row.smtp_port, smtpUser: row.smtp_user, smtpPass: row.smtp_pass,
    isSetupComplete: true, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// ─── Main poll cycle ──────────────────────────────────────────
async function runPollCycle(): Promise<void> {
  if (isRunning) { logger.info('Poll already running, skipping'); return; }
  isRunning = true;
  logger.info('=== Starting poll cycle ===');

  const profile = await loadProfile();
  if (!profile) { logger.info('Profile not set up yet'); isRunning = false; return; }

  // PLAYWRIGHT_HEADLESS=true enforced by Dockerfile ENV
  const isHeadless = process.env.PLAYWRIGHT_HEADLESS === 'true' || process.env.NODE_ENV === 'production';
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: isHeadless,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process'],
    });
    logger.info(`Browser launched (headless=${isHeadless})`);
  }

  const sessionId = uuidv4();
  await db('scraping_sessions').insert({
    id: sessionId, platform: 'all', search_query: profile.targetRoles.join(', '),
    status: 'running', started_at: new Date().toISOString(),
  });

  let totalNew = 0, totalApplied = 0;
  try {
    const [liRes, indeedRes, naukriRes] = await Promise.allSettled([
      scrapeLinkedIn(profile, browser),
      scrapeIndeed(profile, browser),
      scrapeNaukri(profile, browser),
    ]);

    const allRaw = [
      ...(liRes.status === 'fulfilled' ? liRes.value : []),
      ...(indeedRes.status === 'fulfilled' ? indeedRes.value : []),
      ...(naukriRes.status === 'fulfilled' ? naukriRes.value : []),
    ];

    const newJobs = await persistJobs(allRaw, profile);
    totalNew = newJobs.length;

    const toApply = await queueJobsForApply(newJobs);
    for (const job of toApply.slice(0, 10)) {
      const ok = await autoApplyJob(job, profile, browser);
      if (ok) totalApplied++;
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
    }

    await db('scraping_sessions').where('id', sessionId).update({
      ended_at: new Date().toISOString(), status: 'completed',
      jobs_found: allRaw.length, jobs_new: totalNew, jobs_applied: totalApplied,
    });
    logger.info(`Poll complete: ${totalNew} new, ${totalApplied} applied`);
  } catch (err: any) {
    logger.error('Poll cycle error', { error: err.message });
    await db('scraping_sessions').where('id', sessionId).update({ status: 'failed', error_message: err.message, ended_at: new Date().toISOString() });
  } finally {
    isRunning = false;
  }
}

export function startPollingEngine(): void {
  const intervalMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES || '15');
  logger.info(`Starting polling engine (every ${intervalMinutes} min)`);
  pollingJob = new CronJob(`*/${intervalMinutes} * * * *`, runPollCycle, null, true, 'Asia/Kolkata');
  setTimeout(() => runPollCycle(), 8000);
}

export function stopPollingEngine(): void {
  pollingJob?.stop();
  browser?.close().catch(() => {});
  logger.info('Polling engine stopped');
}

export function triggerManualPoll(): void { runPollCycle(); }

export function getEngineStatus(): { running: boolean; nextRun: Date | null } {
  return { running: isRunning, nextRun: pollingJob?.nextDate().toJSDate() || null };
}
