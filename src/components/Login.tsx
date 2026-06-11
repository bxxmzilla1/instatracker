import { FormEvent, useEffect, useState } from 'react';
import { clearSavedCredentials, loadCredentials, saveCredentials } from '../lib/credentials';

interface Props {
  onSuccess: () => void;
}

export function Login({ onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadCredentials().then((creds) => {
      if (active && creds) {
        setUsername(creds.username);
        setPassword(creds.password);
        setRemember(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        if (remember) {
          await saveCredentials({ username, password });
        } else {
          await clearSavedCredentials();
        }
        onSuccess();
        return;
      }

      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Incorrect credentials');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
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
        <p className="login__subtitle">Sign in to continue</p>

        <input
          type="text"
          className="login__input"
          placeholder="Username"
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

        <label className="login__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Save login credentials
        </label>

        {error && <p className="login__error">{error}</p>}

        <button type="submit" className="login__button" disabled={loading || !password.trim()}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
