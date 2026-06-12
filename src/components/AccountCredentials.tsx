import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Secret, TOTP } from 'otpauth';
import type { TrackedAccount } from '../types';

interface CredentialValues {
  loginUsername: string;
  loginEmail: string;
  loginPhone: string;
  loginPassword: string;
  authSecret: string;
}

interface Props {
  account: TrackedAccount;
  onSave: (values: CredentialValues) => Promise<void> | void;
}

function buildTotp(secret: string): TOTP | null {
  const cleaned = secret.replace(/\s+/g, '').toUpperCase();
  if (!cleaned) return null;
  try {
    return new TOTP({
      secret: Secret.fromBase32(cleaned),
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
  } catch {
    return null;
  }
}

export function AccountCredentials({ account, onSave }: Props) {
  const [loginUsername, setLoginUsername] = useState(account.loginUsername || account.username);
  const [loginEmail, setLoginEmail] = useState(account.loginEmail ?? '');
  const [loginPhone, setLoginPhone] = useState(account.loginPhone ?? '');
  const [loginPassword, setLoginPassword] = useState(account.loginPassword ?? '');
  const [authSecret, setAuthSecret] = useState(account.authSecret ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoginUsername(account.loginUsername || account.username);
    setLoginEmail(account.loginEmail ?? '');
    setLoginPhone(account.loginPhone ?? '');
    setLoginPassword(account.loginPassword ?? '');
    setAuthSecret(account.authSecret ?? '');
    setSaved(false);
  }, [
    account.username,
    account.loginUsername,
    account.loginEmail,
    account.loginPhone,
    account.loginPassword,
    account.authSecret,
  ]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const totp = useMemo(() => buildTotp(authSecret), [authSecret]);

  const code = useMemo(() => {
    if (!totp) return null;
    try {
      return totp.generate({ timestamp: now });
    } catch {
      return null;
    }
  }, [totp, now]);

  const remaining = 30 - (Math.floor(now / 1000) % 30);
  const hasInvalidSecret = authSecret.trim().length > 0 && !totp;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        loginUsername: loginUsername.trim(),
        loginEmail: loginEmail.trim(),
        loginPhone: loginPhone.trim(),
        loginPassword,
        authSecret: authSecret.trim(),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  }

  return (
    <form className="cred-form" onSubmit={handleSubmit}>
      <label className="cred-field">
        <span className="cred-field__label">Username</span>
        <input
          className="cred-form__input"
          placeholder="Instagram username"
          value={loginUsername}
          onChange={(e) => {
            setLoginUsername(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="cred-field">
        <span className="cred-field__label">Phone number</span>
        <input
          className="cred-form__input"
          type="tel"
          placeholder="Phone number"
          value={loginPhone}
          onChange={(e) => {
            setLoginPhone(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
        />
      </label>

      <label className="cred-field">
        <span className="cred-field__label">Email</span>
        <input
          className="cred-form__input"
          placeholder="Login email"
          value={loginEmail}
          onChange={(e) => {
            setLoginEmail(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="cred-field">
        <span className="cred-field__label">Password</span>
        <input
          className="cred-form__input"
          type="text"
          placeholder="Login password"
          value={loginPassword}
          onChange={(e) => {
            setLoginPassword(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
        />
      </label>

      <div className="cred-auth">
        <span className="cred-field__label">Auth (2FA)</span>
        <input
          className="cred-form__input"
          placeholder="Authenticator setup key (base32)"
          value={authSecret}
          onChange={(e) => {
            setAuthSecret(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {hasInvalidSecret && (
          <p className="cred-auth__error">That setup key is not valid base32.</p>
        )}

        {code && (
          <div className="cred-auth__code">
            <button type="button" className="cred-auth__value" onClick={copyCode} title="Copy code">
              {code.slice(0, 3)} {code.slice(3)}
            </button>
            <div className="cred-auth__timer">
              <span
                className="cred-auth__ring"
                style={{ '--pct': `${(remaining / 30) * 100}%` } as React.CSSProperties}
              />
              <span className="cred-auth__seconds">{remaining}s</span>
            </div>
            {copied && <span className="cred-auth__copied">Copied</span>}
          </div>
        )}
      </div>

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save credentials'}
      </button>
    </form>
  );
}
