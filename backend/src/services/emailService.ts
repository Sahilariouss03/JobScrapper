import nodemailer from 'nodemailer';
import { InterventionAlert, ApplicationStatus } from '../types';
import { logger } from '../utils/logger';
import { db } from '../database/db';

interface SMTPConfig { host: string; port: number; secure: boolean; user: string; pass: string }

async function getSMTPConfig(): Promise<SMTPConfig | null> {
  const profile = await db('user_profile')
    .select('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass')
    .where('id', 'default').first();

  if (profile?.smtp_host && profile?.smtp_user && profile?.smtp_pass) {
    return { host: profile.smtp_host, port: profile.smtp_port || 587, secure: profile.smtp_port === 465, user: profile.smtp_user, pass: profile.smtp_pass };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'), secure: process.env.SMTP_SECURE === 'true', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  return null;
}

function createTransporter(config: SMTPConfig) {
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });
}

export async function sendInterventionAlert(alert: InterventionAlert): Promise<boolean> {
  const config = await getSMTPConfig();
  if (!config) { logger.warn('Email alert skipped: No SMTP config', { jobId: alert.jobId }); return false; }

  const profile = await db('user_profile').select('alert_email', 'email').where('id', 'default').first();
  const toEmail = profile?.alert_email || profile?.email || config.user;
  const platformLabel = alert.platform.charAt(0).toUpperCase() + alert.platform.slice(1);
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0f0f1a;margin:0;padding:20px}
  .container{max-width:600px;margin:0 auto;background:#1a1a2e;border-radius:16px;overflow:hidden;border:1px solid #2d2d4e}
  .header{background:linear-gradient(135deg,#6c63ff,#f72585);padding:30px;text-align:center}
  .header h1{color:white;margin:0;font-size:22px}
  .body{padding:30px;color:#e0e0e0}
  .job-card{background:#0f0f1a;border:1px solid #2d2d4e;border-radius:12px;padding:20px;margin:20px 0}
  .label{color:#7c7c9c;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  .value{color:#fff;font-size:16px;font-weight:600;margin-bottom:16px}
  .reason-box{background:rgba(247,37,133,0.1);border:1px solid rgba(247,37,133,0.3);border-radius:8px;padding:16px;margin:20px 0}
  .cta{display:block;background:linear-gradient(135deg,#6c63ff,#f72585);color:white;text-decoration:none;padding:16px 32px;border-radius:10px;text-align:center;font-weight:700;font-size:16px;margin:24px 0}
  .footer{background:#0f0f1a;padding:20px;text-align:center;color:#4a4a6a;font-size:12px;border-top:1px solid #2d2d4e}
</style>
</head><body>
<div class="container">
  <div class="header"><h1>⚠️ Manual Intervention Required</h1><p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px">Your Job Scrapper needs your attention</p></div>
  <div class="body">
    <p>The automated applier could not complete this application. Please finish it manually.</p>
    <div class="job-card">
      <div class="label">Job Title</div><div class="value">${alert.jobTitle}</div>
      <div class="label">Company</div><div class="value">${alert.company}</div>
      <div class="label">Platform</div><div class="value">${platformLabel}</div>
      <div class="label">Detected At</div><div class="value" style="font-size:14px;color:#aaa">${timestamp}</div>
    </div>
    <div class="reason-box"><strong style="color:#f72585">🔴 Reason:</strong><p style="margin:8px 0 0">${alert.reason}</p></div>
    <a href="${alert.applyUrl}" class="cta">🚀 Open Application Page</a>
    <p style="color:#7c7c9c;font-size:13px">After applying manually, update the status in your dashboard.</p>
  </div>
  <div class="footer"><p>Job Scrapper — Local Daemon</p><p>Job ID: ${alert.jobId}</p></div>
</div>
</body></html>`;

  try {
    const info = await createTransporter(config).sendMail({
      from: `"Job Scrapper 🤖" <${config.user}>`,
      to: toEmail,
      subject: `⚠️ Manual Action Needed: ${alert.jobTitle} at ${alert.company}`,
      text: `MANUAL INTERVENTION REQUIRED\n\nJob: ${alert.jobTitle}\nCompany: ${alert.company}\nPlatform: ${platformLabel}\nReason: ${alert.reason}\nURL: ${alert.applyUrl}\nJob ID: ${alert.jobId}`,
      html,
    });
    logger.info('Intervention alert sent', { messageId: info.messageId, jobId: alert.jobId });
    return true;
  } catch (error) {
    logger.error('Failed to send alert email', { error, jobId: alert.jobId });
    return false;
  }
}

export async function sendStatusUpdateEmail(jobTitle: string, company: string, oldStatus: ApplicationStatus, newStatus: ApplicationStatus): Promise<boolean> {
  const config = await getSMTPConfig();
  if (!config) return false;
  const profile = await db('user_profile').select('alert_email', 'email').where('id', 'default').first();
  const toEmail = profile?.alert_email || profile?.email || config.user;
  const emoji: Record<ApplicationStatus, string> = { applied:'📨', in_consideration:'👀', interview_scheduled:'📅', offer_received:'🎉', rejected:'❌', withdrawn:'↩️' };
  const fmt = (s: string) => s.split('_').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  try {
    await createTransporter(config).sendMail({
      from: `"Job Scrapper 🤖" <${config.user}>`, to: toEmail,
      subject: `${emoji[newStatus]} Status Update: ${jobTitle} at ${company}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:500px;background:#1a1a2e;color:#e0e0e0;border-radius:12px;overflow:hidden;border:1px solid #2d2d4e"><div style="background:linear-gradient(135deg,#6c63ff,#f72585);padding:24px;text-align:center"><h2 style="color:white;margin:0">${emoji[newStatus]} Application Status Updated</h2></div><div style="padding:24px"><p><strong style="color:#aaa">Job:</strong> ${jobTitle}</p><p><strong style="color:#aaa">Company:</strong> ${company}</p><p><strong style="color:#aaa">Previous:</strong> ${fmt(oldStatus)}</p><p><strong style="color:#6c63ff">New Status:</strong> ${fmt(newStatus)}</p></div></div>`,
    });
    return true;
  } catch (error) { logger.error('Failed to send status email', { error }); return false; }
}

export async function sendDailyDigest(stats: { applied: number; interventions: number; interviews: number }): Promise<boolean> {
  const config = await getSMTPConfig();
  if (!config) return false;
  const profile = await db('user_profile').select('alert_email', 'email', 'full_name').where('id', 'default').first();
  const toEmail = profile?.alert_email || profile?.email || config.user;
  const name = profile?.full_name || 'there';
  const date = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  try {
    await createTransporter(config).sendMail({
      from: `"Job Scrapper 🤖" <${config.user}>`, to: toEmail,
      subject: `📊 Daily Digest: ${stats.applied} applications today`,
      html: `<div style="font-family:Arial,sans-serif;max-width:500px;background:#1a1a2e;color:#e0e0e0;border-radius:12px;overflow:hidden;border:1px solid #2d2d4e"><div style="background:linear-gradient(135deg,#6c63ff,#f72585);padding:24px;text-align:center"><h2 style="color:white;margin:0">📊 Daily Digest</h2><p style="color:rgba(255,255,255,0.8);margin:8px 0 0">${date}</p></div><div style="padding:24px"><p>Hey ${name}! Today: <strong>${stats.applied}</strong> applied, <strong>${stats.interventions}</strong> interventions, <strong>${stats.interviews}</strong> interviews.</p></div></div>`,
    });
    return true;
  } catch (error) { logger.error('Failed to send digest', { error }); return false; }
}
