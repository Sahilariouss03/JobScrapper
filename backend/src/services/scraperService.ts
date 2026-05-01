import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../database/db';
import { sendInterventionAlert } from './emailService';
import { logger } from '../utils/logger';
import { Job, UserProfile, InterventionAlert } from '../types';
import path from 'path';

// ─── Stealth browser context ──────────────────────────────────
async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: { 'Accept-Language': 'en-IN,en;q=0.9' },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return ctx;
}

async function humanDelay(min = 500, max = 1800): Promise<void> {
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));
}

// ─── CAPTCHA / intervention detection ────────────────────────
async function detectIntervention(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const body = document.body.innerText.toLowerCase();
    const checks = [
      { p: 'captcha', r: 'CAPTCHA detected on page' },
      { p: 'verify you are human', r: 'Human verification required' },
      { p: 'security check', r: 'Security check required' },
      { p: 'unusual traffic', r: 'Rate limit / unusual traffic detected' },
      { p: 'sign in to continue', r: 'Login required before applying' },
      { p: 'log in to apply', r: 'Login required to apply' },
    ];
    for (const c of checks) if (body.includes(c.p)) return c.r;
    return null;
  });
}

// ─── Flag job for manual intervention ────────────────────────
async function flagIntervention(job: Job, reason: string): Promise<void> {
  await db('applications').where('job_id', job.id).update({
    intervention_required: 1,
    intervention_reason: reason,
    status_updated_at: new Date().toISOString(),
  });
  await db('jobs').where('id', job.id).update({ status: 'applied' });

  const alert: InterventionAlert = {
    jobId: job.id, jobTitle: job.title, company: job.company,
    applyUrl: job.applyUrl, reason, platform: job.platform,
  };
  await sendInterventionAlert(alert);
  logger.warn('Intervention flagged', { jobId: job.id, reason });
}

// ─── Mark successfully applied ────────────────────────────────
async function markApplied(job: Job): Promise<void> {
  await db('jobs').where('id', job.id).update({ status: 'applied' });
  await db('applications').where('job_id', job.id).update({ status: 'applied', applied_by: 'auto', status_updated_at: new Date().toISOString() });
  await db('activity_log').insert({
    id: uuidv4(), event_type: 'application_submitted', job_id: job.id,
    message: `Auto-applied to ${job.title} at ${job.company}`,
    created_at: new Date().toISOString(),
  });
  logger.info(`Auto-applied: ${job.title} @ ${job.company}`);
}

// ─── Universal form filler ────────────────────────────────────
async function fillFormFields(page: Page, profile: UserProfile): Promise<void> {
  const fields: [string, string][] = [
    ['[name*="name" i]:not([name*="company" i]):not([name*="first" i]):not([name*="last" i]), [placeholder*="full name" i]', profile.fullName],
    ['[name="firstName" i], [name="first_name" i], [placeholder*="first name" i]', profile.fullName.split(' ')[0]],
    ['[name="lastName" i], [name="last_name" i], [placeholder*="last name" i]', profile.fullName.split(' ').slice(1).join(' ')],
    ['[type="email"], [name*="email" i]', profile.email],
    ['[type="tel"], [name*="phone" i], [name*="mobile" i]', profile.phone || ''],
    ['[name*="linkedin" i], [placeholder*="linkedin" i]', profile.linkedinUrl || ''],
    ['[name*="github" i]', profile.githubUrl || ''],
    ['[name*="portfolio" i], [name*="website" i]', profile.portfolioUrl || ''],
    ['[name*="location" i], [name*="city" i], [placeholder*="location" i]', profile.location || ''],
  ];

  for (const [selector, value] of fields) {
    if (!value) continue;
    try {
      const inputs = await page.$$(selector);
      for (const input of inputs) {
        const type = await input.evaluate((el: any) => el.type?.toLowerCase() || '');
        if (['file','hidden','checkbox','radio','submit'].includes(type)) continue;
        const current = await input.evaluate((el: any) => el.value || '');
        if (current && current.length > 2) continue;
        await input.scrollIntoViewIfNeeded();
        await input.fill(value);
        await humanDelay(80, 250);
      }
    } catch { /* selector not found, continue */ }
  }
}

// ─── LinkedIn Easy Apply ──────────────────────────────────────
async function applyLinkedInEasyApply(page: Page, job: Job, profile: UserProfile): Promise<boolean> {
  const easyBtn = await page.$('button.jobs-apply-button, button[aria-label*="Easy Apply"]');
  if (!easyBtn) { await flagIntervention(job, 'LinkedIn Easy Apply button not found — external application'); return false; }
  await easyBtn.click();
  await humanDelay(1500, 2500);

  if (await page.$('div.login-modal, form.login__form')) {
    await flagIntervention(job, 'LinkedIn login required'); return false;
  }

  for (let step = 0; step < 10; step++) {
    await humanDelay(800, 1800);
    const issue = await detectIntervention(page);
    if (issue) { await flagIntervention(job, issue); return false; }
    await fillFormFields(page, profile);

    const fileInput = await page.$('input[type="file"]');
    if (fileInput && profile.resumePath) {
      try { await fileInput.setInputFiles(path.resolve(profile.resumePath)); await humanDelay(800, 1500); } catch {}
    }

    if (await page.$('div.jobs-easy-apply-form__assessment, textarea[name*="question"]')) {
      await flagIntervention(job, 'Custom assessment question requires manual response'); return false;
    }

    const nextBtn = await page.$('button[aria-label="Continue to next step"], button[aria-label="Submit application"], button.artdeco-button--primary');
    if (!nextBtn) break;
    const txt = await nextBtn.textContent();
    await nextBtn.click();
    if (txt?.toLowerCase().includes('submit')) { await humanDelay(2000, 3000); break; }
  }

  await markApplied(job);
  return true;
}

// ─── Generic form apply ───────────────────────────────────────
async function applyGenericForm(page: Page, job: Job, profile: UserProfile): Promise<boolean> {
  await humanDelay(1500, 3000);
  const issue = await detectIntervention(page);
  if (issue) { await flagIntervention(job, issue); return false; }

  await fillFormFields(page, profile);

  const fileInput = await page.$('input[type="file"][accept*="pdf"], input[type="file"][name*="resume"]');
  if (fileInput && profile.resumePath) {
    try { await fileInput.setInputFiles(path.resolve(profile.resumePath)); await humanDelay(800, 1500); } catch {}
  }

  for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Apply")', 'button:has-text("Submit")']) {
    const btn = await page.$(sel);
    if (btn) { await btn.click(); await humanDelay(2000, 3500); break; }
  }

  await markApplied(job);
  return true;
}

// ─── MAIN AUTO-APPLIER ────────────────────────────────────────
export async function autoApplyJob(job: Job, profile: UserProfile, browser: Browser): Promise<boolean> {
  const ctx = await createStealthContext(browser);
  const page = await ctx.newPage();
  try {
    logger.info(`Auto-applying: ${job.title} at ${job.company}`, { jobId: job.id });
    await db('jobs').where('id', job.id).update({ status: 'applying' });

    await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3500);

    const issue = await detectIntervention(page);
    if (issue) { await flagIntervention(job, issue); return false; }

    if (job.platform === 'linkedin') return await applyLinkedInEasyApply(page, job, profile);
    return await applyGenericForm(page, job, profile);
  } catch (err: any) {
    logger.error('Auto-apply error', { jobId: job.id, error: err.message });
    await flagIntervention(job, `Automation error: ${err.message}`);
    return false;
  } finally {
    await ctx.close();
  }
}

// ─── PLATFORM SCRAPERS ────────────────────────────────────────
export async function scrapeLinkedIn(profile: UserProfile, browser: Browser) {
  const jobs: Omit<Job, 'id'|'scrapedAt'|'status'|'matchScore'>[] = [];
  const ctx = await createStealthContext(browser);
  const page = await ctx.newPage();
  try {
    for (const role of profile.targetRoles) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(profile.preferredLocations[0] || 'India')}&f_TPR=r86400&sortBy=DD`;
      logger.info(`Scraping LinkedIn: ${role}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 4000);
      if (await detectIntervention(page)) break;
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 800)); await humanDelay(600, 1200); }

      const cards = await page.$$('div.job-search-card, li.jobs-search-results__list-item');
      for (const card of cards.slice(0, 15)) {
        try {
          const title = await card.$eval('h3', el => el.textContent?.trim() || '').catch(() => '');
          const company = await card.$eval('h4', el => el.textContent?.trim() || '').catch(() => '');
          const location = await card.$eval('.job-search-card__location', el => el.textContent?.trim() || '').catch(() => '');
          const href = await card.$eval('a', el => el.getAttribute('href') || '').catch(() => '');
          const externalId = href.match(/\/jobs\/view\/(\d+)/)?.[1] || uuidv4();
          const postedAt = await card.$('time').then(el => el?.getAttribute('datetime')).catch(() => undefined);
          if (!title || !company) continue;
          const applyUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
          jobs.push({ externalId, platform: 'linkedin', title, company, location, applyUrl, jobUrl: applyUrl, isRemote: location.toLowerCase().includes('remote'), postedAt: postedAt || undefined, salaryCurrency: 'INR', rawData: {} });
        } catch {}
      }
    }
  } finally { await ctx.close(); }
  return jobs;
}

export async function scrapeIndeed(profile: UserProfile, browser: Browser) {
  const jobs: Omit<Job, 'id'|'scrapedAt'|'status'|'matchScore'>[] = [];
  const ctx = await createStealthContext(browser);
  const page = await ctx.newPage();
  try {
    for (const role of profile.targetRoles) {
      const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(role)}&l=${encodeURIComponent(profile.preferredLocations[0] || 'India')}&fromage=1&sort=date`;
      logger.info(`Scraping Indeed: ${role}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 3500);
      if (await detectIntervention(page)) break;
      const cards = await page.$$('div.job_seen_beacon, div.resultContent');
      for (const card of cards.slice(0, 15)) {
        try {
          const title = await card.$eval('h2.jobTitle span', el => el.textContent?.trim() || '').catch(() => '');
          const company = await card.$eval('span.companyName', el => el.textContent?.trim() || '').catch(() => '');
          const location = await card.$eval('div.companyLocation', el => el.textContent?.trim() || '').catch(() => '');
          const href = await card.$eval('h2.jobTitle a', el => el.getAttribute('href') || '').catch(() => '');
          const externalId = href.match(/jk=([a-z0-9]+)/i)?.[1] || uuidv4();
          if (!title || !company) continue;
          const applyUrl = `https://in.indeed.com${href}`;
          jobs.push({ externalId, platform: 'indeed', title, company, location, applyUrl, jobUrl: applyUrl, isRemote: location.toLowerCase().includes('remote'), salaryCurrency: 'INR', rawData: {} });
        } catch {}
      }
    }
  } finally { await ctx.close(); }
  return jobs;
}

export async function scrapeNaukri(profile: UserProfile, browser: Browser) {
  const jobs: Omit<Job, 'id'|'scrapedAt'|'status'|'matchScore'>[] = [];
  const ctx = await createStealthContext(browser);
  const page = await ctx.newPage();
  try {
    for (const role of profile.targetRoles) {
      const url = `https://www.naukri.com/${role.toLowerCase().replace(/\s+/g, '-')}-jobs?jobAge=1`;
      logger.info(`Scraping Naukri: ${role}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(2000, 4000);
      if (await detectIntervention(page)) break;
      const cards = await page.$$('article.jobTuple, div.cust-job-tuple');
      for (const card of cards.slice(0, 15)) {
        try {
          const title = await card.$eval('a.title', el => el.textContent?.trim() || '').catch(() => '');
          const company = await card.$eval('a.subTitle', el => el.textContent?.trim() || '').catch(() => '');
          const location = await card.$eval('li.location span', el => el.textContent?.trim() || '').catch(() => '');
          const href = await card.$eval('a.title', el => el.getAttribute('href') || '').catch(() => '');
          if (!title || !company) continue;
          jobs.push({ externalId: href.split('/').pop()?.split('?')[0] || uuidv4(), platform: 'naukri', title, company, location, applyUrl: href, jobUrl: href, isRemote: location.toLowerCase().includes('remote'), salaryCurrency: 'INR', rawData: {} });
        } catch {}
      }
    }
  } finally { await ctx.close(); }
  return jobs;
}
