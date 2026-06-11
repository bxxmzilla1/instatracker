import { useState } from 'react';
import type { TrackedAccount } from '../types';
import { formatCount, formatDelta, formatRelative, proxiedImage } from '../lib/format';

interface Props {
  account: TrackedAccount;
  followerDelta?: number;
  selected?: boolean;
  refreshing?: boolean;
  onSelect: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}

export function AccountCard({
  account,
  followerDelta,
  selected,
  refreshing,
  onSelect,
  onRefresh,
  onRemove,
}: Props) {
  const delta = formatDelta(account.lastFollowers ?? 0, followerDelta);
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(account.profilePicUrl) && !imgError;

  return (
    <article className={`account-card ${selected ? 'account-card--selected' : ''}`}>
      <button type="button" className="account-card__main" onClick={onSelect}>
        <div className="account-card__avatar">
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
        <div className="account-card__info">
          <div className="account-card__title">
            <strong>@{account.username}</strong>
            {account.isVerified && <span className="badge">✓</span>}
          </div>
          {account.fullName && <p className="account-card__subtitle">{account.fullName}</p>}
          <div className="account-card__stats">
            <span>
              {account.lastFollowers !== undefined ? formatCount(account.lastFollowers) : '—'} followers
            </span>
            {delta && (
              <span className={delta.startsWith('+') ? 'delta delta--up' : delta === '0' ? 'delta' : 'delta delta--down'}>
                {delta}
              </span>
            )}
          </div>
          {account.lastCheckedAt && (
            <p className="account-card__meta">Updated {formatRelative(account.lastCheckedAt)}</p>
          )}
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
