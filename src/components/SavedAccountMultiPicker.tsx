import { useEffect, useMemo, useRef, useState } from 'react';
import type { BskySavedAccount } from '../types';

interface Props {
  accounts: BskySavedAccount[];
  selected: Set<string>;
  all: boolean;
  onToggle: (id: string) => void;
  onAllChange: (all: boolean) => void;
  label?: string;
  hint?: string;
}

function accountLabel(account: BskySavedAccount): string {
  const handle = account.handle.replace(/^@/, '');
  const owner = account.owner && account.owner !== 'admin' ? ` · ${account.owner}` : '';
  return `@${handle}${owner}`;
}

export function SavedAccountMultiPicker({
  accounts,
  selected,
  all,
  onToggle,
  onAllChange,
  label = 'Bluesky account to update',
  hint,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return accounts;
    return accounts.filter((a) => {
      const haystack = `@${a.handle} ${a.owner ?? ''} ${a.email ?? ''} ${a.notes ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [accounts, search]);

  const summary = all
    ? 'All accounts'
    : selected.size === 0
      ? 'Select accounts…'
      : `${selected.size} selected`;

  return (
    <div className="assign-dropdown saved-account-picker" ref={ref}>
      <span className="cred-field__label">{label}</span>
      <button
        type="button"
        className="assign-dropdown__trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{summary}</span>
        <span className={`assign-dropdown__chev ${open ? 'assign-dropdown__chev--open' : ''}`}>▾</span>
      </button>
      {hint && <span className="cred-field__hint">{hint}</span>}

      {open && (
        <div className="assign-dropdown__menu saved-account-picker__menu">
          <div className="saved-account-picker__search account-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              placeholder="Search accounts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="account-search__clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <label className="assign-dropdown__item">
            <input type="checkbox" checked={all} onChange={(e) => onAllChange(e.target.checked)} />
            Select all
          </label>

          {!all &&
            (filtered.length === 0 ? (
              <span className="assign-dropdown__empty">
                {accounts.length === 0
                  ? 'No accounts with saved credentials.'
                  : 'No accounts match your search.'}
              </span>
            ) : (
              filtered.map((account) => (
                <label key={account.id} className="assign-dropdown__item">
                  <input
                    type="checkbox"
                    checked={selected.has(account.id)}
                    onChange={() => onToggle(account.id)}
                  />
                  {accountLabel(account)}
                </label>
              ))
            ))}
        </div>
      )}
    </div>
  );
}
