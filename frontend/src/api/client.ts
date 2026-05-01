import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

// Attach JWT to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('js_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('js_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ─── Auth ────────────────────────────────────────────────────
export const authApi = {
  login: (password: string) =>
    api.post<{ token: string; expiresIn: number }>('/api/auth/login', { password }),
  verify: () => api.get<{ valid: boolean }>('/api/auth/verify'),
};

// ─── Profile ─────────────────────────────────────────────────
export const profileApi = {
  get: () => api.get('/api/profile'),
  save: (formData: FormData) =>
    api.post('/api/profile', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

// ─── Applications ─────────────────────────────────────────────
export const appApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/api/applications', { params }),
  getMetrics: () => api.get('/api/applications/metrics'),
  getRecent: (limit = 10) => api.get('/api/applications/recent', { params: { limit } }),
  updateStatus: (id: string, body: Record<string, unknown>) =>
    api.patch(`/api/applications/${id}/status`, body),
};

// ─── Jobs ─────────────────────────────────────────────────────
export const jobsApi = {
  getAll: (params?: Record<string, unknown>) => api.get('/api/jobs', { params }),
  getActivity: (limit = 20) => api.get('/api/jobs/activity', { params: { limit } }),
  getEngineStatus: () => api.get('/api/jobs/engine-status'),
  triggerPoll: () => api.post('/api/jobs/trigger-poll'),
  skip: (id: string) => api.patch(`/api/jobs/${id}/skip`),
};
