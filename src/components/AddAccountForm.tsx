import { FormEvent, useState } from 'react';

interface Props {
  onAdd: (username: string) => Promise<void>;
  disabled?: boolean;
}

export function AddAccountForm({ onAdd, disabled }: Props) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = username.trim().replace(/^@/, '');
    if (!value) return;

    setLoading(true);
    try {
      await onAdd(value);
      setUsername('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <div className="add-form__field">
        <span className="add-form__prefix">@</span>
        <input
          type="text"
          placeholder="instagram username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={disabled || loading}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" disabled={disabled || loading || !username.trim()}>
        {loading ? 'Adding…' : 'Track'}
      </button>
    </form>
  );
}
