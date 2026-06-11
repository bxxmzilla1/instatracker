import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddAccountForm } from './components/AddAccountForm';
import { AccountCard } from './components/AccountCard';
import { ReelCard } from './components/ReelCard';
import { checkHealth, fetchProfile, fetchReels, fetchStories } from './lib/api';
import {
  addAccount,
  getAccounts,
  getFollowerHistory,
  getReelHistories,
  removeAccount,
  saveFollowerSnapshot,
  saveReelSnapshots,
  updateAccount,
} from './lib/db';
import { formatCount, formatDate, proxiedImage } from './lib/format';
import type {
  FollowerSnapshot,
  ParsedReel,
  ReelHistory,
  StoryPreview,
  TrackedAccount,
} from './types';

export default function App() {
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [followerHistory, setFollowerHistory] = useState<FollowerSnapshot[]>([]);
  const [reelHistories, setReelHistories] = useState<ReelHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(true);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.username === selectedUsername) ?? null,
    [accounts, selectedUsername],
  );

  const selectedUsernameRef = useRef<string | null>(null);
  useEffect(() => {
    selectedUsernameRef.current = selectedUsername;
  }, [selectedUsername]);

  const loadAccounts = useCallback(async () => {
    const rows = await getAccounts();
    setAccounts(rows);
    if (!selectedUsername && rows.length > 0) {
      setSelectedUsername(rows[0].username);
    }
  }, [selectedUsername]);

  const loadAccountDetails = useCallback(async (username: string) => {
    const [followers, reels] = await Promise.all([
      getFollowerHistory(username),
      getReelHistories(username),
    ]);
    setFollowerHistory(followers);
    setReelHistories(reels.sort((a, b) => {
      const aViews = a.snapshots.at(-1)?.views ?? 0;
      const bViews = b.snapshots.at(-1)?.views ?? 0;
      return bViews - aViews;
    }));
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const health = await checkHealth();
        setApiReady(health.hasKey);
        await loadAccounts();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [loadAccounts]);

  useEffect(() => {
    if (selectedUsername) {
      loadAccountDetails(selectedUsername);
    }
  }, [selectedUsername, loadAccountDetails]);

  async function refreshAccount(username: string) {
    setRefreshing(username);
    setError(null);
    setWarning(null);

    try {
      const profile = await fetchProfile(username);
      let reels: ParsedReel[] = [];
      let reelsWarning: string | null = null;

      try {
        const reelsResponse = await fetchReels(username);
        reels = reelsResponse.reels;
      } catch (reelsError) {
        reelsWarning = reelsError instanceof Error ? reelsError.message : 'Could not load reels';
      }

      let stories: StoryPreview[] = [];
      try {
        const parsedStories = await fetchStories(username);
        stories = parsedStories.map((story) => ({
          id: story.id,
          thumbnailUrl: story.thumbnailUrl,
          isVideo: story.isVideo,
          expiringAt: story.expiringAt,
        }));
      } catch {
        stories = [];
      }

      const now = Date.now();

      const account: TrackedAccount = {
        username: profile.username.toLowerCase(),
        addedAt: accounts.find((a) => a.username === profile.username.toLowerCase())?.addedAt ?? now,
        fullName: profile.fullName,
        bio: profile.biography,
        profilePicUrl: profile.profilePicUrl,
        isVerified: profile.isVerified,
        lastFollowers: profile.followers,
        lastFollowing: profile.following,
        lastMediaCount: profile.mediaCount,
        lastCheckedAt: now,
        stories,
      };

      await updateAccount(account);
      await saveFollowerSnapshot({
        username: account.username,
        followers: profile.followers,
        following: profile.following,
        mediaCount: profile.mediaCount,
        capturedAt: now,
      });

      if (reels.length > 0) {
        await saveReelSnapshots(
          reels.map((reel) => ({
            id: reel.id,
            username: account.username,
            shortcode: reel.shortcode,
            caption: reel.caption,
            thumbnailUrl: reel.thumbnailUrl,
            views: reel.views,
            likes: reel.likes,
            comments: reel.comments,
            capturedAt: now,
          })),
        );
      }

      await loadAccounts();
      const isViewingThisAccount =
        !selectedUsernameRef.current || selectedUsernameRef.current === account.username;
      if (isViewingThisAccount) {
        setSelectedUsername(account.username);
        await loadAccountDetails(account.username);
      }

      setWarning(reelsWarning);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(null);
    }
  }

  async function handleAdd(username: string) {
    setError(null);
    setWarning(null);
    const normalized = username.toLowerCase();

    if (accounts.some((a) => a.username === normalized)) {
      setError(`@${normalized} is already tracked`);
      return;
    }

    await addAccount({ username: normalized, addedAt: Date.now() });
    await loadAccounts();
    setSelectedUsername(normalized);
    await refreshAccount(normalized);
  }

  async function handleRemove(username: string) {
    await removeAccount(username);
    const remaining = accounts.filter((a) => a.username !== username);
    setAccounts(remaining);
    setSelectedUsername(remaining[0]?.username ?? null);
    setFollowerHistory([]);
    setReelHistories([]);
  }

  const previousFollowers = followerHistory.length > 1
    ? followerHistory.at(-2)?.followers
    : undefined;

  if (loading) {
    return <div className="app app--centered"><p>Loading Instatracker…</p></div>;
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Instagram analytics</p>
          <h1>Instatracker</h1>
          <p className="subtitle">Track followers and reel views over time</p>
        </div>
      </header>

      {!apiReady && (
        <div className="banner banner--warn">
          Set <code>RAPIDAPI_KEY</code> in Vercel for the Instagram Followers/Following/Stories/Info API, then redeploy.
        </div>
      )}

      {error && <div className="banner banner--error">{error}</div>}
      {warning && !error && <div className="banner banner--warn">{warning}</div>}

      <section className="panel">
        <h2>Add account</h2>
        <AddAccountForm onAdd={handleAdd} disabled={!apiReady || Boolean(refreshing)} />
      </section>

      <div className="layout">
        <section className="panel panel--sidebar">
          <div className="panel__head">
            <h2>Tracked ({accounts.length})</h2>
            {accounts.length > 0 && (
              <button
                type="button"
                className="link-btn"
                disabled={Boolean(refreshing)}
                onClick={async () => {
                  for (const account of accounts) {
                    await refreshAccount(account.username);
                  }
                }}
              >
                Refresh all
              </button>
            )}
          </div>

          {accounts.length === 0 ? (
            <p className="empty-note">No accounts yet. Add a username above to start tracking.</p>
          ) : (
            <div className="account-list">
              {accounts.map((account) => (
                <AccountCard
                  key={account.username}
                  account={account}
                  hasStory={Boolean(account.stories && account.stories.length > 0)}
                  selected={account.username === selectedUsername}
                  refreshing={refreshing === account.username}
                  followerDelta={
                    account.username === selectedUsername ? previousFollowers : undefined
                  }
                  onSelect={() => setSelectedUsername(account.username)}
                  onRefresh={() => refreshAccount(account.username)}
                  onRemove={() => handleRemove(account.username)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="panel panel--detail">
          {selectedAccount ? (
            <>
              <div className="detail-header">
                <div>
                  <h2>@{selectedAccount.username}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => refreshAccount(selectedAccount.username)}
                  disabled={refreshing === selectedAccount.username}
                >
                  {refreshing === selectedAccount.username ? 'Refreshing…' : 'Refresh now'}
                </button>
              </div>

              <div className="metric-grid">
                <div className="metric-card">
                  <span>Followers</span>
                  <strong>{selectedAccount.lastFollowers !== undefined ? formatCount(selectedAccount.lastFollowers) : '—'}</strong>
                </div>
                <div className="metric-card">
                  <span>Following</span>
                  <strong>{selectedAccount.lastFollowing !== undefined ? formatCount(selectedAccount.lastFollowing) : '—'}</strong>
                </div>
                <div className="metric-card">
                  <span>Posts</span>
                  <strong>{selectedAccount.lastMediaCount !== undefined ? formatCount(selectedAccount.lastMediaCount) : '—'}</strong>
                </div>
                <div className="metric-card">
                  <span>Last check</span>
                  <strong>{selectedAccount.lastCheckedAt ? formatDate(selectedAccount.lastCheckedAt) : 'Never'}</strong>
                </div>
              </div>

              {(selectedAccount.fullName || selectedAccount.bio) && (
                <div className="profile-meta">
                  {selectedAccount.fullName && (
                    <div className="profile-meta__row">
                      <span className="profile-meta__label">Name</span>
                      <p className="profile-meta__value">{selectedAccount.fullName}</p>
                    </div>
                  )}
                  {selectedAccount.bio && (
                    <div className="profile-meta__row">
                      <span className="profile-meta__label">Bio</span>
                      <p className="profile-meta__value">{selectedAccount.bio}</p>
                    </div>
                  )}
                </div>
              )}

              {selectedAccount.stories && selectedAccount.stories.length > 0 && (
                <div className="section-block">
                  <h3>
                    Active story <span className="story-pill">{selectedAccount.stories.length}</span>
                  </h3>
                  <div className="story-strip">
                    {selectedAccount.stories.map((story) => (
                      <a
                        key={story.id}
                        className="story-thumb"
                        href={`https://www.instagram.com/stories/${selectedAccount.username}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {story.thumbnailUrl ? (
                          <img src={proxiedImage(story.thumbnailUrl)} alt="Story" loading="lazy" />
                        ) : (
                          <span className="story-thumb__placeholder">▶</span>
                        )}
                        {story.isVideo && <span className="story-thumb__badge">▶</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="section-block">
                <h3>Reels ({reelHistories.length})</h3>
                {reelHistories.length === 0 ? (
                  <p className="empty-note">No reels captured yet. Refresh to pull the latest reels and view counts.</p>
                ) : (
                  <div className="reel-grid">
                    {reelHistories.map((history) => (
                      <ReelCard key={history.reelId} history={history} />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-detail">
              <h2>Select an account</h2>
              <p>Choose a tracked profile to see follower trends and reel performance.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
