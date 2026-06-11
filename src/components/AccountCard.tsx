import { useState } from 'react';
import type { TrackedAccount } from '../types';
import { proxiedImage } from '../lib/format';

interface Props {
  account: TrackedAccount;
  followerDelta?: number;
  totalViews?: number;
  selected?: boolean;
  refreshing?: boolean;
  hasStory?: boolean;
  onSelect: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}

export function AccountCard({
  account,
  selected,
  refreshing,
  hasStory,
  onSelect,
  onRefresh,
  onRemove,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(account.profilePicUrl) && !imgError;

  return (
    <article className={`account-card ${selected ? 'account-card--selected' : ''}`}>
      <button type="button" className="account-card__main" onClick={onSelect}>
        <div className={`account-card__avatar ${hasStory ? 'account-card__avatar--story' : ''}`}>
          {showImage ? (
            <img
              src={proxiedImage(account.profilePicUrl)}
              alt={`@${account.username}`}
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <span>{account.username.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="account-card__title">
          <strong>@{account.username}</strong>
          {account.isVerified && <span className="badge">✓</span>}
        </div>
      </button>
      <div className="account-card__actions">
        <button type="button" onClick={onRefresh} disabled={refreshing} title="Refresh data">
          {refreshing ? '…' : '↻'}
        </button>
        <button type="button" onClick={onRemove} title="Stop tracking">
          ✕
        </button>
      </div>
    </article>
  );
}
