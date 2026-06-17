import { useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const summary = all
    ? 'All accounts'
    : selected.size === 0
      ? 'Select accounts…'
      : `${selected.size} selected`;

  return (
    <div className="assign-dropdown" ref={ref}>
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
        <div className="assign-dropdown__menu">
          <label className="assign-dropdown__item">
            <input type="checkbox" checked={all} onChange={(e) => onAllChange(e.target.checked)} />
            Select all
          </label>

          {!all &&
            (accounts.length === 0 ? (
              <span className="assign-dropdown__empty">No accounts with saved credentials.</span>
            ) : (
              accounts.map((account) => (
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
