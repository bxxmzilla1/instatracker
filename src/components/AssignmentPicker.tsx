import { useEffect, useRef, useState } from 'react';
import type { Employee } from '../types';

interface Props {
  employees: Employee[];
  selected: Set<string>;
  all: boolean;
  onToggle: (username: string) => void;
  onAllChange: (all: boolean) => void;
  adminOption?: boolean;
}

export function AssignmentPicker({ employees, selected, all, onToggle, onAllChange, adminOption }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const onlyAdmin = selected.has('admin') && selected.size === 1;
  const summary = all
    ? 'All employees'
    : selected.size === 0
      ? 'Assign to…'
      : onlyAdmin
        ? 'Admin only'
        : `${selected.size} selected`;

  return (
    <div className="assign-dropdown" ref={ref}>
      <span className="cred-field__label">Assign to</span>
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
          <label className="assign-dropdown__item">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => onAllChange(e.target.checked)}
            />
            Select All
          </label>

          {!all && adminOption && (
            <label className="assign-dropdown__item">
              <input
                type="checkbox"
                checked={selected.has('admin')}
                onChange={() => onToggle('admin')}
              />
              Admin only
            </label>
          )}

          {!all &&
            (employees.length === 0 ? (
              <span className="assign-dropdown__empty">No employees yet.</span>
            ) : (
              employees.map((employee) => (
                <label key={employee.username} className="assign-dropdown__item">
                  <input
                    type="checkbox"
                    checked={selected.has(employee.username)}
                    onChange={() => onToggle(employee.username)}
                  />
                  {employee.username}
                </label>
              ))
            ))}
        </div>
      )}
    </div>
  );
}
