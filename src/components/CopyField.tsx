import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
  className?: string;
}

export function CopyField({ value, label, className }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <button
      type="button"
      className={`copy-field ${className ?? ''}`}
      onClick={copy}
      title="Click to copy"
    >
      {label && <span className="copy-field__label">{label}</span>}
      <span className="copy-field__value">{value || '—'}</span>
      <span className="copy-field__icon">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}
