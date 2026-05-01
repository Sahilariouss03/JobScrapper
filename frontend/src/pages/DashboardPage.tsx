import { useEffect, useState, useCallback } from 'react';
import { appApi, jobsApi } from '../api/client';
import toast from 'react-hot-toast';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────
interface Metrics {
  totalApplied: number;
  inConsideration: number;
  interviewsScheduled: number;
  rejected: number;
  offersReceived: number;
  interventionsRequired: number;
  todayApplied: number;
}

interface RecentApp {
  id: string;
  status: string;
  appliedAt: string;
  interventionRequired: boolean;
  appliedBy: string;
  job: { title: string; company: string; platform: string; location: string; applyUrl: string; matchScore: number };
}

interface EngineStatus { running: boolean; nextRun: string | null }

// ─── Helpers ──────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  applied:            { label: 'Applied',         className: 'status-applied' },
  in_consideration:   { label: 'In Review',        className: 'status-review' },
  interview_scheduled:{ label: 'Interview',        className: 'status-interview' },
  offer_received:     { label: 'Offer 🎉',         className: 'status-offer' },
  rejected:           { label: 'Rejected',         className: 'status-rejected' },
  withdrawn:          { label: 'Withdrawn',        className: 'status-withdrawn' },
};

const PLATFORM_ICONS: Record<string, string> = {
  linkedin: '💼', indeed: '🔍', naukri: '🇮🇳',
  workday: '⚙️', greenhouse: '🌱', lever: '⚡', other: '🌐',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

// ─── MetricCard ───────────────────────────────────────────────
function MetricCard({ label, value, icon, accent, sub }: {
  label: string; value: number; icon: string; accent: string; sub?: string
}) {
  return (
    <div className="metric-card" style={{ '--accent': accent } as React.CSSProperties}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-body">
        <div className="metric-value">{value.toLocaleString()}</div>
        <div className="metric-label">{label}</div>
        {sub && <div className="metric-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────
export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recent, setRecent] = useState<RecentApp[]>([]);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [chartData, setChartData] = useState<{ date: string; applied: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [mRes, rRes, eRes, allRes] = await Promise.all([
        appApi.getMetrics(),
        appApi.getRecent(10),
        jobsApi.getEngineStatus(),
        appApi.getAll({ limit: 90 }),
      ]);
      setMetrics(mRes.data);
      setRecent(rRes.data);
      setEngine(eRes.data);

      // Build 14-day chart data
      const apps: { appliedAt: string }[] = allRes.data.applications;
      const today = new Date();
      const days: Record<string, number> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days[d.toISOString().slice(0, 10)] = 0;
      }
      apps.forEach(a => {
        const d = a.appliedAt.slice(0, 10);
        if (d in days) days[d]++;
      });
      setChartData(Object.entries(days).map(([date, applied]) => ({
        date: new Date(date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
        applied,
      })));
    } catch {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  async function handleTriggerPoll() {
    try {
      await jobsApi.triggerPoll();
      toast.success('Poll triggered! Checking for new jobs…');
    } catch { toast.error('Failed to trigger poll'); }
  }

  async function handleStatusChange(appId: string, newStatus: string) {
    setUpdatingId(appId);
    try {
      await appApi.updateStatus(appId, { status: newStatus });
      toast.success('Status updated');
      fetchData();
    } catch { toast.error('Failed to update status'); }
    finally { setUpdatingId(null); }
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-orb" />
        <p>Loading dashboard…</p>
      </div>
    );
  }

  const m = metrics!;

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <header className="dash-header">
        <div className="dash-title">
          <h1>⚡ Job Scrapper</h1>
          <p>Automated job hunting dashboard</p>
        </div>
        <div className="dash-controls">
          <div className={`engine-badge ${engine?.running ? 'running' : 'idle'}`}>
            <span className="pulse-dot" />
            {engine?.running ? 'Engine Running' : 'Engine Idle'}
            {engine?.nextRun && !engine.running && (
              <span className="next-run">
                Next: {new Date(engine.nextRun).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <button className="btn-trigger" onClick={handleTriggerPoll}>
            🔄 Poll Now
          </button>
        </div>
      </header>

      {/* ── Metric Cards ── */}
      <section className="metrics-grid" aria-label="Application metrics">
        <MetricCard label="Total Applied"       value={m.totalApplied}         icon="📨" accent="#6c63ff" sub={`+${m.todayApplied} today`} />
        <MetricCard label="In Consideration"    value={m.inConsideration}      icon="👀" accent="#4cc9f0" />
        <MetricCard label="Interviews Scheduled" value={m.interviewsScheduled} icon="📅" accent="#4ade80" />
        <MetricCard label="Offers Received"     value={m.offersReceived}       icon="🎉" accent="#fbbf24" />
        <MetricCard label="Rejected"            value={m.rejected}             icon="❌" accent="#f87171" />
        <MetricCard label="Need Attention"      value={m.interventionsRequired} icon="⚠️" accent="#f72585" sub="Manual required" />
      </section>

      {/* ── Activity Chart ── */}
      <section className="chart-section">
        <h2>Applications — Last 14 Days</h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6c63ff" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6c63ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d2d4e" />
            <XAxis dataKey="date" tick={{ fill: '#7c7c9c', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: '#7c7c9c', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#1a1a2e', border: '1px solid #2d2d4e', borderRadius: 8, color: '#e0e0e0' }}
              labelStyle={{ color: '#aaa' }}
            />
            <Area type="monotone" dataKey="applied" stroke="#6c63ff" strokeWidth={2} fill="url(#grad)" name="Applied" />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      {/* ── Recent Applications Table ── */}
      <section className="recent-section">
        <div className="section-header">
          <h2>Recent Applications <span className="badge">{recent.length}</span></h2>
        </div>
        <div className="table-wrapper">
          <table className="jobs-table" aria-label="Recent job applications">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Platform</th>
                <th>Location</th>
                <th>Match</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-row">
                    No applications yet. Trigger a poll to start scraping! 🚀
                  </td>
                </tr>
              ) : (
                recent.map(app => (
                  <tr
                    key={app.id}
                    className={app.interventionRequired ? 'row-alert' : ''}
                  >
                    <td className="td-company">
                      <strong>{app.job.company}</strong>
                      {app.interventionRequired && (
                        <span className="intervention-badge" title={`Manual intervention required`}>⚠️</span>
                      )}
                    </td>
                    <td className="td-role">
                      <a href={app.job.applyUrl} target="_blank" rel="noopener noreferrer">
                        {app.job.title}
                      </a>
                    </td>
                    <td className="td-platform">
                      <span className="platform-pill">
                        {PLATFORM_ICONS[app.job.platform] || '🌐'} {app.job.platform}
                      </span>
                    </td>
                    <td className="td-location">{app.job.location || '—'}</td>
                    <td className="td-match">
                      <div className="match-bar-wrap">
                        <div className="match-bar" style={{ width: `${app.job.matchScore}%` }} />
                        <span>{app.job.matchScore}%</span>
                      </div>
                    </td>
                    <td className="td-date">{fmt(app.appliedAt)}</td>
                    <td className="td-status">
                      <span className={`status-chip ${STATUS_CONFIG[app.status]?.className}`}>
                        {STATUS_CONFIG[app.status]?.label ?? app.status}
                      </span>
                    </td>
                    <td className="td-action">
                      <select
                        id={`status-select-${app.id}`}
                        className="status-select"
                        value={app.status}
                        disabled={updatingId === app.id}
                        onChange={e => handleStatusChange(app.id, e.target.value)}
                        aria-label={`Update status for ${app.job.title} at ${app.job.company}`}
                      >
                        {ALL_STATUSES.map(s => (
                          <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
