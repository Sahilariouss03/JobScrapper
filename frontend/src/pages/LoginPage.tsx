import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(password);
      toast.success('Welcome back!');
    } catch {
      toast.error('Invalid password. Try again.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-icon">⚡</span>
          <h1>Job Scrapper</h1>
          <p>Your automated job hunting daemon</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="field-group">
            <label htmlFor="password">Dashboard Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Access Dashboard →'}
          </button>
        </form>
        <p className="login-hint">
          Set your password in the backend <code>.env</code> file via <code>DASHBOARD_PASSWORD</code>
        </p>
      </div>
    </div>
  );
}
