import { useEffect, useRef, useState } from 'react';
import type { TrackedAccount } from '../types';

interface Props {
  accounts: TrackedAccount[];
  selected: Set<string>;
  onToggle: (username: string) => void;
  label?: string;
}

export function AccountPicker({
  accounts,
  selected,
  onToggle,
  label = 'Instagram accounts',
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

  const summary =
    selected.size === 0
      ? 'Select accounts…'
      : `${selected.size} account${selected.size === 1 ? '' : 's'}`;

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

      {open && (
        <div className="assign-dropdown__menu">
          {accounts.length === 0 ? (
            <span className="assign-dropdown__empty">No tracked accounts yet.</span>
          ) : (
            accounts.map((account) => {
              const hasApi = Boolean(account.igUserId && account.igAccessToken);
              return (
                <label key={account.username} className="assign-dropdown__item">
                  <input
                    type="checkbox"
                    checked={selected.has(account.username)}
                    onChange={() => onToggle(account.username)}
                  />
                  @{account.username}
                  {!hasApi && (
                    <span className="assign-dropdown__hint"> · no API creds</span>
                  )}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
