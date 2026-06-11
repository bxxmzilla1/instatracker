import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddAccountForm } from './components/AddAccountForm';
import { AccountCard } from './components/AccountCard';
import { AccountCredentials } from './components/AccountCredentials';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { ReelCard } from './components/ReelCard';
import { checkHealth, fetchProfile, fetchReels, fetchStories } from './lib/api';
import {
  addAccount,
  addEmployee,
  deleteEmployee,
  getAccounts,
  getAllFollowerSnapshots,
  getAllReelSnapshots,
  getEmployees,
  getFollowerHistory,
  getReelHistories,
  removeAccount,
  saveFollowerSnapshot,
  saveReelSnapshots,
  updateAccount,
} from './lib/db';
import { latestByReel } from './lib/dashboard';
import { cacheImage, imgKey } from './lib/media';
import { formatCount, formatDate, proxiedImage } from './lib/format';
import type {
  Employee,
  FollowerSnapshot,
  ParsedReel,
  ReelHistory,
  ReelSnapshot,
  Session,
  StoryPreview,
  TrackedAccount,
} from './types';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem('drbossing_session');
    if (raw) return JSON.parse(raw) as Session;
  } catch {
    // ignore
  }
  if (localStorage.getItem('drbossing_auth') === '1') {
    return { role: 'admin', username: 'admin' };
  }
  return null;
}

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
  const [allReelSnapshots, setAllReelSnapshots] = useState<ReelSnapshot[]>([]);
  const [allFollowerSnapshots, setAllFollowerSnapshots] = useState<FollowerSnapshot[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [view, setView] = useState<'dashboard' | 'accounts' | 'employee'>('dashboard');
  const [showCredentials, setShowCredentials] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesOpen, setEmployeesOpen] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');

  const isAdmin = session?.role === 'admin';

  const ownerFilter = useMemo(() => {
    if (!session) return undefined;
    if (session.role === 'employee') return session.username;
    if (view === 'employee') return selectedEmployee ?? '__none__';
    return undefined;
  }, [session, view, selectedEmployee]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.username === selectedUsername) ?? null,
    [accounts, selectedUsername],
  );

  const selectedUsernameRef = useRef<string | null>(null);
  useEffect(() => {
    selectedUsernameRef.current = selectedUsername;
  }, [selectedUsername]);

  const viewsByUsername = useMemo(() => {
    const map = new Map<string, number>();
    for (const reel of latestByReel(allReelSnapshots)) {
      map.set(reel.username, (map.get(reel.username) ?? 0) + reel.views);
    }
    return map;
  }, [allReelSnapshots]);

  const loadAccounts = useCallback(async () => {
    const rows = await getAccounts(ownerFilter);
    setAccounts(rows);
  }, [ownerFilter]);

  const loadDashboardData = useCallback(async () => {
    const [reels, followers] = await Promise.all([
      getAllReelSnapshots(),
      getAllFollowerSnapshots(),
    ]);
    setAllReelSnapshots(reels);
    setAllFollowerSnapshots(followers);
  }, []);

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
    if (!session) return;
    async function init() {
      try {
        const health = await checkHealth();
        setApiReady(health.hasKey);
        await loadDashboardData();
        if (session?.role === 'admin') {
          setEmployees(await getEmployees());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [session, loadDashboardData]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setAccountsLoading(true);
    setSelectedUsername(null);
    (async () => {
      const [rows] = await Promise.all([getAccounts(ownerFilter), loadDashboardData()]);
      if (!active) return;
      setAccounts(rows);
      setSelectedUsername((current) =>
        rows.some((r) => r.username === current) ? current : rows[0]?.username ?? null,
      );
      setAccountsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [session, ownerFilter, loadDashboardData]);

  useEffect(() => {
    if (selectedUsername) {
      loadAccountDetails(selectedUsername);
    } else {
      setFollowerHistory([]);
      setReelHistories([]);
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
      const existing = accounts.find((a) => a.username === profile.username.toLowerCase());
      const defaultOwner = session?.role === 'employee' ? session.username : 'admin';
      const handle = profile.username.toLowerCase();

      // Cache all images into Supabase Storage so they load fast and never expire.
      const [cachedProfilePic, cachedStories, cachedReels] = await Promise.all([
        cacheImage(profile.profilePicUrl, `profiles/${imgKey(handle)}.jpg`),
        Promise.all(
          stories.map(async (story) => ({
            ...story,
            thumbnailUrl: await cacheImage(
              story.thumbnailUrl,
              `stories/${imgKey(handle)}-${imgKey(story.id)}.jpg`,
            ),
          })),
        ),
        Promise.all(
          reels.map(async (reel) => ({
            ...reel,
            thumbnailUrl: await cacheImage(reel.thumbnailUrl, `reels/${imgKey(reel.id)}.jpg`),
          })),
        ),
      ]);

      const account: TrackedAccount = {
        username: handle,
        addedAt: existing?.addedAt ?? now,
        fullName: profile.fullName,
        bio: profile.biography,
        profilePicUrl: cachedProfilePic,
        isVerified: profile.isVerified,
        lastFollowers: profile.followers,
        lastFollowing: profile.following,
        lastMediaCount: profile.mediaCount,
        lastCheckedAt: now,
        stories: cachedStories,
        owner: existing?.owner ?? defaultOwner,
        loginUsername: existing?.loginUsername,
        loginPassword: existing?.loginPassword,
        authSecret: existing?.authSecret,
        banned: existing?.banned,
        bannedAt: existing?.bannedAt,
      };

      await updateAccount(account);
      await saveFollowerSnapshot({
        username: account.username,
        followers: profile.followers,
        following: profile.following,
        mediaCount: profile.mediaCount,
        capturedAt: now,
      });

      if (cachedReels.length > 0) {
        await saveReelSnapshots(
          cachedReels.map((reel) => ({
            id: reel.id,
            username: account.username,
            shortcode: reel.shortcode,
            caption: reel.caption,
            thumbnailUrl: reel.thumbnailUrl,
            views: reel.views,
            likes: reel.likes,
            comments: reel.comments,
            capturedAt: now,
            takenAt: reel.takenAt,
          })),
        );
      }

      await loadAccounts();
      await loadDashboardData();
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

    const owner = session?.role === 'employee' ? session.username : 'admin';

    try {
      await addAccount({ username: normalized, addedAt: Date.now(), owner });
      await loadAccounts();
      setSelectedUsername(normalized);
      await refreshAccount(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this account.');
    }
  }

  async function handleAddEmployee(event: FormEvent) {
    event.preventDefault();
    const username = newEmpUsername.trim().toLowerCase();
    if (!username || !newEmpPassword.trim()) return;
    if (employees.some((e) => e.username === username)) {
      setError(`Employee "${username}" already exists`);
      return;
    }
    try {
      await addEmployee({ username, password: newEmpPassword, createdAt: Date.now() });
      setEmployees(await getEmployees());
      setNewEmpUsername('');
      setNewEmpPassword('');
      setShowAddEmployee(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add employee.');
    }
  }

  async function handleDeleteEmployee(username: string) {
    await deleteEmployee(username);
    setEmployees(await getEmployees());
    if (selectedEmployee === username) {
      setSelectedEmployee(null);
      setView('accounts');
    }
  }

  async function handleSaveCredentials(
    loginUsername: string,
    loginPassword: string,
    authSecret: string,
  ) {
    if (!selectedAccount) return;
    const updated: TrackedAccount = {
      ...selectedAccount,
      loginUsername: loginUsername || undefined,
      loginPassword: loginPassword || undefined,
      authSecret: authSecret || undefined,
    };
    await updateAccount(updated);
    await loadAccounts();
  }

  async function handleToggleBanned() {
    if (!selectedAccount) return;
    const banned = !selectedAccount.banned;
    const updated: TrackedAccount = {
      ...selectedAccount,
      banned,
      bannedAt: banned ? Date.now() : undefined,
    };
    await updateAccount(updated);
    await loadAccounts();
  }

  async function handleRemove(username: string) {
    await removeAccount(username);
    const remaining = accounts.filter((a) => a.username !== username);
    setAccounts(remaining);
    setSelectedUsername(remaining[0]?.username ?? null);
    setFollowerHistory([]);
    setReelHistories([]);
    await loadDashboardData();
  }

  const previousFollowers = followerHistory.length > 1
    ? followerHistory.at(-2)?.followers
    : undefined;

  const visibleUsernames = useMemo(
    () => new Set(accounts.map((a) => a.username)),
    [accounts],
  );
  const scopedReelSnapshots = useMemo(
    () => allReelSnapshots.filter((s) => visibleUsernames.has(s.username)),
    [allReelSnapshots, visibleUsernames],
  );
  const scopedFollowerSnapshots = useMemo(
    () => allFollowerSnapshots.filter((s) => visibleUsernames.has(s.username)),
    [allFollowerSnapshots, visibleUsernames],
  );

  if (!session) {
    return (
      <Login
        onSuccess={(next) => {
          localStorage.setItem('drbossing_session', JSON.stringify(next));
          localStorage.removeItem('drbossing_auth');
          setLoading(true);
          setView('dashboard');
          setSelectedEmployee(null);
          setSession(next);
        }}
      />
    );
  }

  if (loading) {
    return <div className="app app--centered"><p>Loading Dr. Bossing…</p></div>;
  }

  function handleLock() {
    localStorage.removeItem('drbossing_session');
    localStorage.removeItem('drbossing_auth');
    setSession(null);
    setEmployees([]);
    setSelectedEmployee(null);
  }

  const topbarTitle =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'employee'
        ? `Employee · ${selectedEmployee ?? ''}`
        : 'Accounts';

  const showAddForm = view === 'accounts';

  const loadingBlock = (
    <div className="loading-block">
      <span className="spinner" aria-hidden />
      <span>Loading accounts…</span>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="sidebar__name">Dr. Bossing</span>
        </div>

        <nav className="sidebar__nav">
          <button
            type="button"
            className={view === 'dashboard' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('dashboard');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            Dashboard
          </button>
          <button
            type="button"
            className={view === 'accounts' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('accounts');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19c0-3 2.7-5 5.5-5s5.5 2 5.5 5" />
              <path d="M16 5.2a3 3 0 0 1 0 5.6" />
              <path d="M18 14c2.2.4 3.8 2.2 3.8 4.6" />
            </svg>
            Accounts
          </button>

          {isAdmin && (
            <div className="sidebar__group">
              <button
                type="button"
                className="nav-item"
                onClick={() => setEmployeesOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="8" r="3.2" />
                  <path d="M3.5 19c0-3 2.7-5 5.5-5s5.5 2 5.5 5" />
                  <path d="M16 5.2a3 3 0 0 1 0 5.6" />
                  <path d="M18 14c2.2.4 3.8 2.2 3.8 4.6" />
                </svg>
                Employees
                <span className={`nav-item__chevron ${employeesOpen ? 'nav-item__chevron--open' : ''}`}>
                  ›
                </span>
              </button>

              {employeesOpen && (
                <div className="sidebar__sub">
                  <button
                    type="button"
                    className="nav-subitem nav-subitem--add"
                    onClick={() => setShowAddEmployee(true)}
                  >
                    + Add new employee
                  </button>
                  {employees.map((employee) => (
                    <button
                      key={employee.username}
                      type="button"
                      className={
                        view === 'employee' && selectedEmployee === employee.username
                          ? 'nav-subitem nav-subitem--active'
                          : 'nav-subitem'
                      }
                      onClick={() => {
                        setSelectedEmployee(employee.username);
                        setView('employee');
                      }}
                    >
                      {employee.username}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>

        <button type="button" className="nav-item sidebar__lock" onClick={handleLock}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Lock
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{topbarTitle}</h1>
          <div className="topbar__actions">
            {view === 'employee' && selectedEmployee && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => handleDeleteEmployee(selectedEmployee)}
              >
                Remove employee
              </button>
            )}
            {(view === 'accounts' || view === 'employee') && accounts.length > 0 && (
              <button
                type="button"
                className="btn btn--ghost"
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
        </header>

        {!apiReady && (
          <div className="banner banner--warn">
            Set <code>RAPIDAPI_KEY</code> in Vercel for the Instagram Followers/Following/Stories/Info API, then redeploy.
          </div>
        )}

        {error && <div className="banner banner--error">{error}</div>}
        {warning && !error && <div className="banner banner--warn">{warning}</div>}

        {view === 'dashboard' &&
          (accountsLoading ? (
            <section className="panel">{loadingBlock}</section>
          ) : accounts.length > 0 ? (
            <Dashboard
              accounts={accounts}
              reelSnapshots={scopedReelSnapshots}
              followerSnapshots={scopedFollowerSnapshots}
            />
          ) : (
            <section className="panel empty-detail">
              <h2>No accounts yet</h2>
              <p>Go to Accounts to add an Instagram username and start tracking.</p>
              <button type="button" className="btn" onClick={() => setView('accounts')}>
                Go to Accounts
              </button>
            </section>
          ))}

        {(view === 'accounts' || view === 'employee') && (
          <>
            {view === 'employee' && !accountsLoading && accounts.length > 0 && (
              <Dashboard
                accounts={accounts}
                reelSnapshots={scopedReelSnapshots}
                followerSnapshots={scopedFollowerSnapshots}
              />
            )}

            {showAddForm && (
              <section className="panel">
                <h2>Add account</h2>
                <AddAccountForm onAdd={handleAdd} disabled={!apiReady || Boolean(refreshing)} />
              </section>
            )}

            <div className="layout">
              <section className="panel panel--sidebar">
          <div className="panel__head">
            <h2>Tracked ({accounts.length})</h2>
          </div>

          {accountsLoading ? (
            loadingBlock
          ) : accounts.length === 0 ? (
            <p className="empty-note">
              {view === 'employee'
                ? 'This employee has not added any accounts yet.'
                : 'No accounts yet. Add a username above to start tracking.'}
            </p>
          ) : (
            <div className="account-list">
              {accounts.map((account) => (
                <AccountCard
                  key={account.username}
                  account={account}
                  hasStory={Boolean(account.stories && account.stories.length > 0)}
                  totalViews={viewsByUsername.get(account.username) ?? 0}
                  ownerTag={
                    isAdmin && account.owner && account.owner !== 'admin'
                      ? account.owner
                      : undefined
                  }
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
          {accountsLoading ? (
            loadingBlock
          ) : selectedAccount ? (
            <>
              <div className="detail-header">
                <div>
                  <h2>@{selectedAccount.username}</h2>
                  {isAdmin && selectedAccount.owner && selectedAccount.owner !== 'admin' && (
                    <span className="owner-tag owner-tag--detail">
                      Added by {selectedAccount.owner}
                    </span>
                  )}
                </div>
                <div className="detail-header__actions">
                  <button
                    type="button"
                    className="btn--ghost"
                    onClick={() => setShowCredentials(true)}
                  >
                    Credentials
                  </button>
                  <button
                    type="button"
                    className={selectedAccount.banned ? 'btn--danger-active' : 'btn--danger'}
                    onClick={handleToggleBanned}
                  >
                    {selectedAccount.banned ? 'Banned ✓' : 'Banned'}
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshAccount(selectedAccount.username)}
                    disabled={refreshing === selectedAccount.username}
                  >
                    {refreshing === selectedAccount.username ? 'Refreshing…' : 'Refresh now'}
                  </button>
                </div>
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
                  <span>Reel Views</span>
                  <strong>{formatCount(viewsByUsername.get(selectedAccount.username) ?? 0)}</strong>
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
                      <button
                        key={story.id}
                        type="button"
                        className="story-thumb"
                        onClick={() => story.thumbnailUrl && setFullscreenImage(story.thumbnailUrl)}
                        disabled={!story.thumbnailUrl}
                      >
                        {story.thumbnailUrl ? (
                          <img src={proxiedImage(story.thumbnailUrl)} alt="Story" loading="lazy" />
                        ) : (
                          <span className="story-thumb__placeholder">▶</span>
                        )}
                        {story.isVideo && <span className="story-thumb__badge">▶</span>}
                      </button>
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
                      <ReelCard
                        key={history.reelId}
                        history={history}
                        addedAt={selectedAccount.addedAt}
                      />
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
          </>
        )}

        {showCredentials && selectedAccount && (
          <div className="modal" onClick={() => setShowCredentials(false)}>
            <div className="modal__card" onClick={(e) => e.stopPropagation()}>
              <div className="modal__head">
                <h3>Account credentials</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setShowCredentials(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="cred-note">
                Stored privately for @{selectedAccount.username} in your database.
              </p>
              <AccountCredentials account={selectedAccount} onSave={handleSaveCredentials} />
            </div>
          </div>
        )}

        {fullscreenImage && (
          <div className="lightbox" onClick={() => setFullscreenImage(null)}>
            <button
              type="button"
              className="lightbox__close"
              onClick={() => setFullscreenImage(null)}
              aria-label="Close"
            >
              ✕
            </button>
            <img
              className="lightbox__img"
              src={proxiedImage(fullscreenImage)}
              alt="Story"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {showAddEmployee && (
          <div className="modal" onClick={() => setShowAddEmployee(false)}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleAddEmployee}
            >
              <div className="modal__head">
                <h3>Add new employee</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setShowAddEmployee(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="cred-note">
                Create a sub-account that can add and track its own Instagram accounts.
              </p>
              <div className="cred-form">
                <label className="cred-field">
                  <span className="cred-field__label">Username</span>
                  <input
                    className="cred-form__input"
                    placeholder="employee username"
                    value={newEmpUsername}
                    onChange={(e) => setNewEmpUsername(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="cred-field">
                  <span className="cred-field__label">Password</span>
                  <input
                    className="cred-form__input"
                    type="text"
                    placeholder="password"
                    value={newEmpPassword}
                    onChange={(e) => setNewEmpPassword(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button type="submit" disabled={!newEmpUsername.trim() || !newEmpPassword.trim()}>
                  Create employee
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
