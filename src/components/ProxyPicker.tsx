import { useEffect, useMemo, useRef, useState } from 'react';
import type { Proxy } from '../types';

interface Props {
  proxies: Proxy[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  optionLabel: (proxy: Proxy) => string;
}

const DIRECT_LABEL = 'No proxy (direct)';

export function ProxyPicker({
  proxies,
  value,
  onChange,
  label = 'Proxy for this account',
  optionLabel,
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

  const selected = proxies.find((p) => p.id === value);

  const searchWords = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search],
  );

  const showDirect = useMemo(() => {
    if (searchWords.length === 0) return true;
    const haystack = DIRECT_LABEL.toLowerCase();
    return searchWords.every((word) => haystack.includes(word));
  }, [searchWords]);

  const filtered = useMemo(() => {
    if (searchWords.length === 0) return proxies;
    return proxies.filter((p) => {
      const haystack = [
        optionLabel(p),
        p.label,
        p.type,
        p.raw,
        p.host,
        p.port,
        p.username,
        p.password,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchWords.every((word) => haystack.includes(word));
    });
  }, [proxies, searchWords, optionLabel]);

  const summary = selected ? optionLabel(selected) : DIRECT_LABEL;

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setSearch('');
  }

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

      {open && (
        <div className="assign-dropdown__menu saved-account-picker__menu">
          <div className="saved-account-picker__search account-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              placeholder="Search proxies…"
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
          {!showDirect && filtered.length === 0 ? (
            <span className="assign-dropdown__empty">No proxies match your search.</span>
          ) : (
            <>
              {showDirect && (
                <button
                  type="button"
                  className={
                    !value
                      ? 'saved-account-picker__option saved-account-picker__option--selected'
                      : 'saved-account-picker__option'
                  }
                  onClick={() => pick('')}
                >
                  {DIRECT_LABEL}
                </button>
              )}
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    value === p.id
                      ? 'saved-account-picker__option saved-account-picker__option--selected'
                      : 'saved-account-picker__option'
                  }
                  onClick={() => pick(p.id)}
                >
                  {optionLabel(p)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
