import Knex from 'knex';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

const DB_PATH = process.env.DB_PATH || './data/jobscrapper.db';

// Ensure data directory exists
const dataDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const db = Knex({
  client: 'sqlite3',
  connection: { filename: path.resolve(DB_PATH) },
  useNullAsDefault: true,
  pool: { min: 1, max: 1 },
  asyncStackTraces: process.env.NODE_ENV !== 'production',
});

// ─── Run raw SQL for schema creation ─────────────────────────
async function raw(sql: string): Promise<void> {
  await db.raw(sql);
}

export async function initializeDatabase(): Promise<void> {
  logger.info('Initializing SQLite database via Knex...');

  // Enable WAL mode
  await raw(`PRAGMA journal_mode = WAL`);
  await raw(`PRAGMA foreign_keys = ON`);

  // ── USER PROFILE ────────────────────────────────────────────
  if (!(await db.schema.hasTable('user_profile'))) {
    await db.schema.createTable('user_profile', t => {
      t.string('id').primary().defaultTo('default');
      t.string('full_name').notNullable();
      t.string('email').notNullable();
      t.string('phone');
      t.string('location');
      t.string('linkedin_url');
      t.string('github_url');
      t.string('portfolio_url');
      t.string('headline');
      t.text('summary');
      t.text('education').notNullable().defaultTo('[]');
      t.text('experience').notNullable().defaultTo('[]');
      t.text('skills').notNullable().defaultTo('[]');
      t.text('certifications').notNullable().defaultTo('[]');
      t.string('resume_path');
      t.string('resume_name');
      t.text('target_roles').notNullable().defaultTo('[]');
      t.text('preferred_locations').notNullable().defaultTo('[]');
      t.text('preferred_job_types').notNullable().defaultTo('["Full-time"]');
      t.integer('min_salary');
      t.integer('max_salary');
      t.string('remote_preference').defaultTo('Any');
      t.string('alert_email');
      t.string('smtp_host');
      t.integer('smtp_port');
      t.string('smtp_user');
      t.string('smtp_pass');
      t.integer('is_setup_complete').notNullable().defaultTo(0);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
  }

  // ── JOBS ─────────────────────────────────────────────────────
  if (!(await db.schema.hasTable('jobs'))) {
    await db.schema.createTable('jobs', t => {
      t.string('id').primary();
      t.string('external_id');
      t.string('platform').notNullable();
      t.string('title').notNullable();
      t.string('company').notNullable();
      t.string('location');
      t.string('job_type');
      t.integer('salary_min');
      t.integer('salary_max');
      t.string('salary_currency').defaultTo('INR');
      t.text('description');
      t.text('requirements');
      t.text('apply_url').notNullable();
      t.text('job_url');
      t.integer('is_remote').defaultTo(0);
      t.string('posted_at');
      t.timestamp('scraped_at').defaultTo(db.fn.now());
      t.string('status').notNullable().defaultTo('new');
      t.float('match_score').defaultTo(0);
      t.text('raw_data').defaultTo('{}');
      t.unique(['platform', 'external_id']);
    });
    await raw(`CREATE INDEX IF NOT EXISTS idx_jobs_platform ON jobs(platform)`);
    await raw(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    await raw(`CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at)`);
  }

  // ── APPLICATIONS ─────────────────────────────────────────────
  if (!(await db.schema.hasTable('applications'))) {
    await db.schema.createTable('applications', t => {
      t.string('id').primary();
      t.string('job_id').notNullable().references('id').inTable('jobs').onDelete('CASCADE');
      t.string('status').notNullable().defaultTo('applied');
      t.timestamp('applied_at').defaultTo(db.fn.now());
      t.timestamp('status_updated_at').defaultTo(db.fn.now());
      t.text('cover_letter');
      t.string('resume_path');
      t.text('answers_used').defaultTo('{}');
      t.string('interview_date');
      t.string('interview_type');
      t.text('notes');
      t.integer('salary_offered');
      t.string('applied_by').defaultTo('auto');
      t.text('error_message');
      t.integer('intervention_required').defaultTo(0);
      t.text('intervention_reason');
      t.unique(['job_id']);
    });
    await raw(`CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`);
    await raw(`CREATE INDEX IF NOT EXISTS idx_applications_applied_at ON applications(applied_at)`);
  }

  // ── SCRAPING SESSIONS ────────────────────────────────────────
  if (!(await db.schema.hasTable('scraping_sessions'))) {
    await db.schema.createTable('scraping_sessions', t => {
      t.string('id').primary();
      t.string('platform').notNullable();
      t.string('search_query').notNullable();
      t.timestamp('started_at').defaultTo(db.fn.now());
      t.timestamp('ended_at');
      t.integer('jobs_found').defaultTo(0);
      t.integer('jobs_new').defaultTo(0);
      t.integer('jobs_applied').defaultTo(0);
      t.string('status').defaultTo('running');
      t.text('error_message');
    });
  }

  // ── ACTIVITY LOG ─────────────────────────────────────────────
  if (!(await db.schema.hasTable('activity_log'))) {
    await db.schema.createTable('activity_log', t => {
      t.string('id').primary();
      t.string('event_type').notNullable();
      t.string('job_id').references('id').inTable('jobs').onDelete('SET NULL');
      t.text('message').notNullable();
      t.text('metadata').defaultTo('{}');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
    await raw(`CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)`);
  }

  logger.info('Database initialized successfully.');
}
