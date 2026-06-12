import { useState } from 'react';

interface Props {
  value: string;
  title?: string;
}

export function CopyButton({ value, title }: Props) {
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
    <button type="button" className="row-edit" onClick={copy} title={title ?? 'Copy'}>
      {copied ? '✓' : '⧉'}
    </button>
  );
}
