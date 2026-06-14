import { FormEvent, useState } from 'react';
import { getEmployees } from '../lib/db';
import { getEmployees as getBskyEmployees } from '../lib/bsky/db';
import { getEmployees as getBskyEmployeesLocal } from '../lib/bsky/dbLocal';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Employee, Session } from '../types';

interface Props {
  onSuccess: (session: Session) => void;
}

export function Login({ onSuccess }: Props) {
  const [tab, setTab] = useState<'admin' | 'employee'>('employee');
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
      const handle = username.trim().toLowerCase();
      const pass = password.trim();
      const matches = (e: Employee) =>
        e.username.trim().toLowerCase() === handle && (e.password ?? '').trim() === pass;

      // Fetch both employee lists independently so a failure in one platform
      // never blocks logging in on the other.
      const [igEmployees, bskyEmployees] = await Promise.all([
        getEmployees().catch(() => [] as Employee[]),
        getBskyEmployees().catch(() => [] as Employee[]),
      ]);

      const igMatch = igEmployees.find(matches);
      if (igMatch) {
        onSuccess({ role: 'employee', username: igMatch.username, platform: 'instagram' });
        return;
      }

      let bskyMatch = bskyEmployees.find(matches);
      // Fallback: if Supabase is configured but the account was stored locally
      // (or the remote lookup failed), also check the local Bluesky store.
      if (!bskyMatch && isSupabaseConfigured) {
        const localBsky = await getBskyEmployeesLocal().catch(() => [] as Employee[]);
        bskyMatch = localBsky.find(matches);
      }
      if (bskyMatch) {
        onSuccess({ role: 'employee', username: bskyMatch.username, platform: 'bluesky' });
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
      <div className="login__bg" aria-hidden />
      <div className="login__stage">
        <div className="login__diamond" aria-hidden />
        <div className="login__card">
        <div className="login__brand">
          <span className="login__mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 3h12l4 6-10 12L2 9z" />
              <path d="M2 9h20M9 3 7 9l5 12M15 3l2 6-5 12" />
            </svg>
          </span>
          <h1>Dr. Bossing</h1>
        </div>

        <div className="login__tabs">
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
    </div>
  );
}
