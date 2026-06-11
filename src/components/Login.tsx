import { FormEvent, useState } from 'react';
import { getEmployees } from '../lib/db';
import type { Session } from '../types';

interface Props {
  onSuccess: (session: Session) => void;
}

export function Login({ onSuccess }: Props) {
  const [tab, setTab] = useState<'admin' | 'employee'>('admin');
  const [passcode, setPasscode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdmin(event: FormEvent) {
    event.preventDefault();
    if (!passcode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passcode }),
      });
      if (response.ok) {
        onSuccess({ role: 'admin', username: 'admin' });
        return;
      }
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Incorrect passcode');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleEmployee(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const employees = await getEmployees();
      const match = employees.find(
        (e) => e.username.toLowerCase() === username.trim().toLowerCase() && e.password === password,
      );
      if (match) {
        onSuccess({ role: 'employee', username: match.username });
        return;
      }
      setError('Incorrect employee username or password');
    } catch {
      setError('Could not verify employee. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="sidebar__logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <h1>Dr. Bossing</h1>
        </div>

        <div className="login__tabs">
          <button
            type="button"
            className={tab === 'admin' ? 'login__tab login__tab--active' : 'login__tab'}
            onClick={() => {
              setTab('admin');
              setError(null);
            }}
          >
            Admin
          </button>
          <button
            type="button"
            className={tab === 'employee' ? 'login__tab login__tab--active' : 'login__tab'}
            onClick={() => {
              setTab('employee');
              setError(null);
            }}
          >
            Employee
          </button>
        </div>

        {tab === 'admin' ? (
          <form className="login__form" onSubmit={handleAdmin}>
            <input
              type="password"
              className="login__input"
              placeholder="Passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
            {error && <p className="login__error">{error}</p>}
            <button type="submit" className="login__button" disabled={loading || !passcode.trim()}>
              {loading ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        ) : (
          <form className="login__form" onSubmit={handleEmployee}>
            <input
              type="text"
              className="login__input"
              placeholder="Employee username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <input
              type="password"
              className="login__input"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <p className="login__error">{error}</p>}
            <button
              type="submit"
              className="login__button"
              disabled={loading || !username.trim() || !password.trim()}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
