// ============================================================
//  Shared TypeScript Types / Interfaces
// ============================================================

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;
  grade?: string;
  current: boolean;
}

export interface Experience {
  company: string;
  title: string;
  location?: string;
  startDate: string; // YYYY-MM
  endDate?: string;  // YYYY-MM or 'Present'
  current: boolean;
  description: string;
  achievements?: string[];
}

export interface Certification {
  name: string;
  issuer: string;
  year?: number;
  url?: string;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  headline?: string;
  summary?: string;
  education: Education[];
  experience: Experience[];
  skills: string[];
  certifications: Certification[];
  resumePath?: string;
  resumeName?: string;
  targetRoles: string[];
  preferredLocations: string[];
  preferredJobTypes: string[];
  minSalary?: number;
  maxSalary?: number;
  remotePreference: 'Remote' | 'Hybrid' | 'Onsite' | 'Any';
  alertEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  isSetupComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export type Platform = 'linkedin' | 'indeed' | 'naukri' | 'workday' | 'greenhouse' | 'lever' | 'other';

export type JobStatus = 'new' | 'queued' | 'applying' | 'applied' | 'skipped' | 'error';

export interface Job {
  id: string;
  externalId?: string;
  platform: Platform;
  title: string;
  company: string;
  location?: string;
  jobType?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  description?: string;
  requirements?: string;
  applyUrl: string;
  jobUrl?: string;
  isRemote: boolean;
  postedAt?: string;
  scrapedAt: string;
  status: JobStatus;
  matchScore: number;
  rawData: Record<string, unknown>;
}

export type ApplicationStatus =
  | 'applied'
  | 'in_consideration'
  | 'interview_scheduled'
  | 'offer_received'
  | 'rejected'
  | 'withdrawn';

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string;
  statusUpdatedAt: string;
  coverLetter?: string;
  resumePath?: string;
  answersUsed: Record<string, string>;
  interviewDate?: string;
  interviewType?: string;
  notes?: string;
  salaryOffered?: number;
  appliedBy: 'auto' | 'manual';
  errorMessage?: string;
  interventionRequired: boolean;
  interventionReason?: string;
  // Joined fields from jobs table
  job?: Job;
}

export interface ApplicationWithJob extends Application {
  job: Job;
}

export interface ScrapingSession {
  id: string;
  platform: Platform;
  searchQuery: string;
  startedAt: string;
  endedAt?: string;
  jobsFound: number;
  jobsNew: number;
  jobsApplied: number;
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface ActivityLog {
  id: string;
  eventType: 'job_scraped' | 'application_submitted' | 'status_changed' | 'error' | 'intervention';
  jobId?: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardMetrics {
  totalApplied: number;
  inConsideration: number;
  interviewsScheduled: number;
  rejected: number;
  offersReceived: number;
  interventionsRequired: number;
  todayApplied: number;
}

export interface InterventionAlert {
  jobId: string;
  jobTitle: string;
  company: string;
  applyUrl: string;
  reason: string;
  platform: Platform;
}
