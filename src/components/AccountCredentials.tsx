import { FormEvent, useEffect, useState } from 'react';
import type { TrackedAccount } from '../types';

interface Props {
  account: TrackedAccount;
  onSave: (loginUsername: string, loginPassword: string) => Promise<void> | void;
}

export function AccountCredentials({ account, onSave }: Props) {
  const [loginUsername, setLoginUsername] = useState(account.loginUsername ?? '');
  const [loginPassword, setLoginPassword] = useState(account.loginPassword ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoginUsername(account.loginUsername ?? '');
    setLoginPassword(account.loginPassword ?? '');
    setSaved(false);
    setShowPassword(false);
  }, [account.username, account.loginUsername, account.loginPassword]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(loginUsername.trim(), loginPassword);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="cred-form" onSubmit={handleSubmit}>
      <input
        className="cred-form__input"
        placeholder="Login username or email"
        value={loginUsername}
        onChange={(e) => {
          setLoginUsername(e.target.value);
          setSaved(false);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="cred-form__password">
        <input
          className="cred-form__input"
          type={showPassword ? 'text' : 'password'}
          placeholder="Login password"
          value={loginPassword}
          onChange={(e) => {
            setLoginPassword(e.target.value);
            setSaved(false);
          }}
          autoComplete="off"
        />
        <button
          type="button"
          className="cred-form__toggle"
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save credentials'}
      </button>
    </form>
  );
}
