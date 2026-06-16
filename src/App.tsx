import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddAccountForm } from './components/AddAccountForm';
import { AccountCard } from './components/AccountCard';
import { AccountCredentials } from './components/AccountCredentials';
import { AccountInsights } from './components/AccountInsights';
import { AssignmentPicker } from './components/AssignmentPicker';
import { BlueskySection } from './components/BlueskySection';
import { CopyButton } from './components/CopyButton';
import { CopyField } from './components/CopyField';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { ReelCard } from './components/ReelCard';
import { checkHealth, fetchProfile, fetchReels } from './lib/api';
import {
  addAccount,
  addEmployee,
  addBio,
  addCta,
  addLicense,
  addProxy,
  deleteBio,
  deleteCta,
  deleteEmployee,
  deleteLicense,
  deleteProxy,
  getAccounts,
  getAllFollowerSnapshots,
  getAllReelSnapshots,
  getBios,
  getCtas,
  getEmployees,
  getFollowerHistory,
  getLicenses,
  getProxies,
  getReelHistories,
  getStories,
  addStory,
  deleteStory,
  getContent,
  addContent,
  updateContent,
  deleteContent,
  getApiLink,
  saveApiLink,
  removeAccount,
  saveFollowerSnapshot,
  saveReelSnapshots,
  updateAccount,
} from './lib/db';
import { assignedEmployees } from './lib/assignment';
import { getScheduledPostsForDate, normalizeScheduledPosts } from './lib/contentSchedule';
import { parseProxyString } from './lib/proxy';
import { proxyOptionLabel, proxyToRelayConfig } from './lib/proxyRelay';
import { publishContent } from './lib/igGraph';
import type { PublishProgress } from './lib/igGraph';
import {
  formatDateLocal,
  formatDateTimeLocal,
  formatTimeLocal,
  getTimezoneLabel,
  nowDatetimeLocal,
  parseDatetimeLocal,
  shiftDateKey,
  toDateKey,
} from './lib/timezone';
import {
  ALL_MEDIA_ACCEPT,
  contentMediaLabel,
  contentTabLabel,
  contentTabSingular,
  extForContentFile,
  getContentMediaUrls,
  isContentPublishing,
  isImageFile,
  isStoryVideo,
  isVideoFile,
  MAX_CAROUSEL_ITEMS,
  MIN_CAROUSEL_ITEMS,
} from './lib/content';
import { latestByReel, withMonotonicReelViews } from './lib/dashboard';
import { cacheImage, imgKey } from './lib/media';
import { formatCount, formatDate, proxiedImage } from './lib/format';
import type {
  ApiLink,
  Bio,
  ContentMediaType,
  ContentReel,
  Cta,
  Employee,
  FollowerSnapshot,
  License,
  ParsedReel,
  Platform,
  Proxy,
  ReelHistory,
  ReelSnapshot,
  Session,
  StoryNote,
  TrackedAccount,
} from './types';
import { META_SESSIONS_LINK_ID } from './types';

const META_SESSIONS_LINK_LABEL = 'Sessions Link - Meta Developer';

function externalHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function publishProgressPercent(p: PublishProgress): number {
  switch (p.stage) {
    case 'creating':
      return 20;
    case 'processing':
      return 55;
    case 'publishing':
      return 85;
    case 'done':
      return 100;
    default:
      return 10;
  }
}

function publishProgressLabel(p: PublishProgress): string {
  switch (p.stage) {
    case 'creating':
      return 'Preparing media…';
    case 'processing':
      return 'Processing video on Instagram…';
    case 'publishing':
      return 'Publishing…';
    case 'done':
      return 'Published!';
    default:
      return 'Working…';
  }
}

function PublishProgressBar({
  stage,
  className,
}: {
  stage: PublishProgress['stage'];
  className?: string;
}) {
  const progress = { stage: stage ?? 'creating' };
  return (
    <div className={className ? `publish-progress ${className}` : 'publish-progress'}>
      <div className="publish-progress__track">
        <div
          className="publish-progress__fill"
          style={{ width: `${publishProgressPercent(progress)}%` }}
        />
      </div>
      <span className="publish-progress__label">{publishProgressLabel(progress)}</span>
    </div>
  );
}

function ContentMediaPreview({
  reel,
  compact,
}: {
  reel: ContentReel;
  compact?: boolean;
}) {
  const urls = getContentMediaUrls(reel);
  const mediaClass = compact ? 'schedule-card__thumb' : 'reel-cell__media';

  if (reel.mediaType === 'carousel') {
    if (compact) {
      return (
        <div className="schedule-card__thumb-wrap schedule-card__thumb-wrap--carousel">
          <img
            className="schedule-card__thumb"
            src={urls[0]}
            alt="Carousel cover"
            loading="lazy"
          />
          <span className="schedule-card__carousel-count">{urls.length}</span>
        </div>
      );
    }
    return (
      <div className="carousel-cell__album">
        {urls.map((url, i) => (
          <img
            key={`${url}-${i}`}
            className="carousel-cell__thumb"
            src={url}
            alt={`Slide ${i + 1}`}
            loading="lazy"
          />
        ))}
      </div>
    );
  }

  const showImage =
    reel.mediaType === 'image' || (reel.mediaType === 'story' && !isStoryVideo(reel));
  if (showImage) {
    return (
      <img
        className={mediaClass}
        src={reel.videoUrl}
        alt={reel.caption || contentMediaLabel(reel.mediaType)}
        loading="lazy"
      />
    );
  }
  return (
    <video
      className={mediaClass}
      src={reel.videoUrl}
      autoPlay={!compact}
      loop={!compact}
      muted
      playsInline
    />
  );
}

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
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  const [refreshAllProgress, setRefreshAllProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [failedRefresh, setFailedRefresh] = useState<Set<string>>(() => new Set());
  const [accountSearch, setAccountSearch] = useState('');
  const [view, setView] = useState<
    | 'dashboard'
    | 'accounts'
    | 'employees'
    | 'employee'
    | 'license'
    | 'proxy'
    | 'api'
    | 'bio'
    | 'cta'
    | 'content'
    | 'schedule'
  >('dashboard');
  const [showCredentials, setShowCredentials] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [platform, setPlatform] = useState<Platform>(() => loadSession()?.platform ?? 'instagram');

  // Keep the persisted session in sync with the active platform so a reload
  // restores the platform the user was last on (e.g. Bluesky).
  useEffect(() => {
    if (!session) return;
    try {
      localStorage.setItem('drbossing_session', JSON.stringify({ ...session, platform }));
    } catch {
      // ignore
    }
  }, [session, platform]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeAccountCounts, setEmployeeAccountCounts] = useState<Record<string, number>>({});
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');
  const [licenses, setLicenses] = useState<License[]>([]);
  const [newLicense, setNewLicense] = useState('');
  const [newLicenseEmployees, setNewLicenseEmployees] = useState<Set<string>>(() => new Set());
  const [newLicenseAll, setNewLicenseAll] = useState(false);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [newProxy, setNewProxy] = useState('');
  const [newProxyEmployees, setNewProxyEmployees] = useState<Set<string>>(() => new Set());
  const [newProxyAll, setNewProxyAll] = useState(false);
  const [newProxyType, setNewProxyType] = useState('http');
  const [newProxyRotating, setNewProxyRotating] = useState('');
  const [editItem, setEditItem] = useState<{
    kind: 'proxy' | 'license' | 'bio' | 'cta' | 'story';
    id: string;
    createdAt: number;
    text: string;
    rotating: string;
    type: string;
    employees: Set<string>;
    allEmployees: boolean;
  } | null>(null);
  const [bios, setBios] = useState<Bio[]>([]);
  const [newBioText, setNewBioText] = useState('');
  const [assignBio, setAssignBio] = useState<Bio | null>(null);
  const [assignBioEmployees, setAssignBioEmployees] = useState<Set<string>>(() => new Set());
  const [assignBioAll, setAssignBioAll] = useState(false);
  const [savingBioAssign, setSavingBioAssign] = useState(false);
  const [ctas, setCtas] = useState<Cta[]>([]);
  const [newCtaText, setNewCtaText] = useState('');
  const [newCtaEmployees, setNewCtaEmployees] = useState<Set<string>>(() => new Set());
  const [newCtaAll, setNewCtaAll] = useState(false);
  const [stories, setStories] = useState<StoryNote[]>([]);
  const [newStoryText, setNewStoryText] = useState('');
  const [newStoryEmployees, setNewStoryEmployees] = useState<Set<string>>(() => new Set());
  const [newStoryAll, setNewStoryAll] = useState(false);
  const [content, setContent] = useState<ContentReel[]>([]);
  const [contentTab, setContentTab] = useState<ContentMediaType>('reel');
  const [scheduleFilterTab, setScheduleFilterTab] = useState<'all' | ContentMediaType>('all');
  const [newContentCaption, setNewContentCaption] = useState('');
  const [newContentEmployees, setNewContentEmployees] = useState<Set<string>>(() => new Set());
  const [newContentAll, setNewContentAll] = useState(false);
  const [newContentTarget, setNewContentTarget] = useState('');
  const [newContentProxyId, setNewContentProxyId] = useState('');
  const [newContentScheduledAt, setNewContentScheduledAt] = useState('');
  const [uploadingContent, setUploadingContent] = useState(false);
  const contentFileRef = useRef<HTMLInputElement>(null);
  const [scheduleReel, setScheduleReel] = useState<ContentReel | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'post' | 'schedule'>('schedule');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [assignReel, setAssignReel] = useState<ContentReel | null>(null);
  const [savingAssign, setSavingAssign] = useState(false);
  const [publishProgress, setPublishProgress] = useState<PublishProgress | null>(null);
  const [historyReel, setHistoryReel] = useState<ContentReel | null>(null);
  const [metaSessionsLink, setMetaSessionsLink] = useState<ApiLink | null>(null);
  const [editingMetaSessionsLink, setEditingMetaSessionsLink] = useState(false);
  const [metaSessionsDraft, setMetaSessionsDraft] = useState('');
  const [savingMetaSessionsLink, setSavingMetaSessionsLink] = useState(false);
  const [scheduleViewDate, setScheduleViewDate] = useState<string>(() => toDateKey(Date.now()));
  const timezoneLabel = getTimezoneLabel();
  const [contentEmployeeFilter, setContentEmployeeFilter] = useState('');
  const [openAddForms, setOpenAddForms] = useState<Set<string>>(() => new Set());

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
  const hasAccountsRef = useRef(false);
  useEffect(() => {
    selectedUsernameRef.current = selectedUsername;
  }, [selectedUsername]);
  useEffect(() => {
    hasAccountsRef.current = accounts.length > 0;
  }, [accounts.length]);

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

  const loadLicenses = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setLicenses(await getLicenses(filter));
  }, [session]);

  const loadProxies = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setProxies(await getProxies(filter));
  }, [session]);

  const loadBios = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setBios(await getBios(filter));
  }, [session]);

  const loadCtas = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setCtas(await getCtas(filter));
  }, [session]);

  const loadStories = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setStories(await getStories(filter));
  }, [session]);

  const loadContent = useCallback(async () => {
    if (!session) return;
    const filter = session.role === 'employee' ? session.username : undefined;
    setContent(await getContent(filter));
  }, [session]);

  const loadMetaSessionsLink = useCallback(async () => {
    try {
      setMetaSessionsLink(await getApiLink(META_SESSIONS_LINK_ID));
    } catch {
      setMetaSessionsLink(null);
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    const [reels, followers] = await Promise.all([
      getAllReelSnapshots(),
      getAllFollowerSnapshots(),
    ]);
    setAllReelSnapshots(withMonotonicReelViews(reels));
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
      const onBluesky = platform === 'bluesky';
      try {
        const health = await checkHealth();
        setApiReady(health.hasKey);
        if (onBluesky) setLoading(false);
        await loadDashboardData();
        await loadLicenses();
        await loadProxies();
        await loadBios();
        await loadCtas();
        await loadStories();
        await loadContent();
        void loadMetaSessionsLink();
        if (session?.role === 'admin') {
          const [emps, allAccts] = await Promise.all([getEmployees(), getAccounts()]);
          setEmployees(emps);
          const counts: Record<string, number> = {};
          for (const a of allAccts) {
            const owner = a.owner ?? 'admin';
            counts[owner] = (counts[owner] ?? 0) + 1;
          }
          setEmployeeAccountCounts(counts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [
    session,
    loadDashboardData,
    loadLicenses,
    loadProxies,
    loadBios,
    loadCtas,
    loadStories,
    loadContent,
    loadMetaSessionsLink,
  ]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const hasCachedAccounts = hasAccountsRef.current;
    if (hasCachedAccounts) setDashboardRefreshing(true);
    else {
      setAccountsLoading(true);
      setSelectedUsername(null);
    }
    (async () => {
      try {
        const [rows] = await Promise.all([getAccounts(ownerFilter), loadDashboardData()]);
        if (!active) return;
        setAccounts(rows);
        setSelectedUsername((current) =>
          rows.some((r) => r.username === current) ? current : rows[0]?.username ?? null,
        );
      } finally {
        if (active) {
          setAccountsLoading(false);
          setDashboardRefreshing(false);
        }
      }
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

  // Always poll content so publish progress is visible from any browser/tab.
  useEffect(() => {
    if (!session) return;

    void loadContent();
    const id = setInterval(() => void loadContent(), 2000);
    return () => clearInterval(id);
  }, [session, loadContent]);

  const publishingContent = content.filter((c) => isContentPublishing(c));

  useEffect(() => {
    if (!scheduleReel) return;
    const fresh = content.find((c) => c.id === scheduleReel.id);
    if (!fresh) return;
    if (
      fresh.publishingAt !== scheduleReel.publishingAt ||
      fresh.publishStage !== scheduleReel.publishStage ||
      fresh.postedAt !== scheduleReel.postedAt ||
      fresh.postError !== scheduleReel.postError
    ) {
      setScheduleReel(fresh);
    }
  }, [content, scheduleReel]);

  const modalPublishProgress: PublishProgress | null =
    publishProgress ??
    (scheduleReel && isContentPublishing(scheduleReel)
      ? {
          stage:
            scheduleReel.publishStage ??
            scheduleReel.scheduledPosts?.find((post) => post.publishingAt)?.publishStage ??
            'creating',
        }
      : null);

  function markRefreshFailed(username: string) {
    setFailedRefresh((prev) => {
      const next = new Set(prev);
      next.add(username);
      return next;
    });
  }

  function clearRefreshFailed(username: string) {
    setFailedRefresh((prev) => {
      if (!prev.has(username)) return prev;
      const next = new Set(prev);
      next.delete(username);
      return next;
    });
  }

  async function refreshOne(username: string) {
    setRefreshing(username);

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

      const now = Date.now();
      const existing = accounts.find((a) => a.username === profile.username.toLowerCase());
      const defaultOwner = session?.role === 'employee' ? session.username : 'admin';
      const handle = profile.username.toLowerCase();

      // Cache all images into Supabase Storage so they load fast and never expire.
      const [cachedProfilePic, cachedReels] = await Promise.all([
        cacheImage(profile.profilePicUrl, `profiles/${imgKey(handle)}.jpg`),
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
        stories: [],
        owner: existing?.owner ?? defaultOwner,
        loginUsername: existing?.loginUsername,
        loginEmail: existing?.loginEmail,
        loginPhone: existing?.loginPhone,
        loginPassword: existing?.loginPassword,
        authSecret: existing?.authSecret,
        igUserId: existing?.igUserId,
        igAccessToken: existing?.igAccessToken,
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

      clearRefreshFailed(username);
      setWarning(reelsWarning);
    } finally {
      setRefreshing(null);
    }
  }

  function suspendedMessage(err: unknown, username: string) {
    const msg = err instanceof Error ? err.message : 'Refresh failed';

    // Only treat a failure as a possible ban/suspension when the API explicitly
    // says the specific account was not found or is private. EVERYTHING else
    // (API key, subscription, quota, rate-limit, 5xx, network) is a system-level
    // problem and the real message must be shown so it can actually be fixed.
    const isAccountLevel =
      /was not found or the account is private|account is private|user not found/i.test(msg);

    return isAccountLevel ? `@${username} might be suspended/banned, please check status` : msg;
  }

  async function refreshAccount(username: string) {
    setError(null);
    setWarning(null);
    const account = accounts.find((a) => a.username === username);
    if (account?.banned) {
      setWarning(`@${username} is marked banned — refresh skipped.`);
      return;
    }
    try {
      await refreshOne(username);
    } catch (err) {
      markRefreshFailed(username);
      setError(suspendedMessage(err, username));
    }
  }

  async function handleRefreshAll() {
    setError(null);
    setWarning(null);
    const list = accounts.filter((a) => !a.banned);
    if (list.length === 0) return;

    setRefreshAllProgress({ done: 0, total: list.length });
    const failed: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      try {
        await refreshOne(list[i].username);
      } catch {
        failed.push(list[i].username);
        markRefreshFailed(list[i].username);
      }
      setRefreshAllProgress({ done: i + 1, total: list.length });
      // Pause between accounts to avoid overloading the Apify API
      if (i < list.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    setRefreshAllProgress(null);

    if (failed.length > 0) {
      setWarning(
        `Unable to refresh ${failed.length} account(s): ${failed
          .map((u) => `@${u}`)
          .join(', ')}`,
      );
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

  function toggleLicenseEmployee(username: string) {
    setNewLicenseEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleAddLicense(event: FormEvent) {
    event.preventDefault();
    const license = newLicense.trim();
    if (!license || (!newLicenseAll && newLicenseEmployees.size === 0)) return;
    try {
      await addLicense({
        id: crypto.randomUUID(),
        license,
        employees: newLicenseAll ? [] : [...newLicenseEmployees],
        allEmployees: newLicenseAll,
        createdAt: Date.now(),
      });
      await loadLicenses();
      setNewLicense('');
      setNewLicenseEmployees(new Set());
      setNewLicenseAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add license.');
    }
  }

  async function handleDeleteLicense(id: string) {
    await deleteLicense(id);
    await loadLicenses();
  }

  function toggleProxyEmployee(username: string) {
    setNewProxyEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleAddProxy(event: FormEvent) {
    event.preventDefault();
    const raw = newProxy.trim();
    if (!raw || (!newProxyAll && newProxyEmployees.size === 0)) return;
    const parsed = parseProxyString(raw);
    if (!parsed) {
      setError('Could not parse that proxy. Use host:port:user:pass or user:pass@host:port.');
      return;
    }
    try {
      await addProxy({
        id: crypto.randomUUID(),
        raw,
        type: newProxyType,
        host: parsed.host,
        port: parsed.port,
        username: parsed.user,
        password: parsed.pass,
        rotatingLink: newProxyRotating.trim(),
        employees: newProxyAll ? [] : [...newProxyEmployees],
        allEmployees: newProxyAll,
        createdAt: Date.now(),
      });
      await loadProxies();
      setNewProxy('');
      setNewProxyEmployees(new Set());
      setNewProxyAll(false);
      setNewProxyType('http');
      setNewProxyRotating('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add proxy.');
    }
  }

  async function handleDeleteProxy(id: string) {
    await deleteProxy(id);
    await loadProxies();
  }

  async function handleUpdateProxyType(proxy: Proxy, type: string) {
    try {
      await addProxy({ ...proxy, type });
      await loadProxies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update proxy.');
    }
  }

  async function submitBio() {
    const text = newBioText.trim();
    if (!text) return;
    try {
      await addBio({
        id: crypto.randomUUID(),
        text: newBioText,
        employees: [],
        allEmployees: false,
        createdAt: Date.now(),
      });
      await loadBios();
      setNewBioText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bio.');
    }
  }

  function openAssignBioModal(bio: Bio) {
    setAssignBio(bio);
    setAssignBioEmployees(new Set(bio.employees ?? []));
    setAssignBioAll(bio.allEmployees);
  }

  function closeAssignBioModal() {
    setAssignBio(null);
    setAssignBioEmployees(new Set());
    setAssignBioAll(false);
  }

  function toggleAssignBioEmployee(username: string) {
    setAssignBioEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function saveBioAssign() {
    if (!assignBio) return;
    if (!assignBioAll && assignBioEmployees.size === 0) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    setSavingBioAssign(true);
    try {
      await addBio({
        ...assignBio,
        employees: assignBioAll ? [] : [...assignBioEmployees],
        allEmployees: assignBioAll,
      });
      await loadBios();
      closeAssignBioModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign bio.');
    } finally {
      setSavingBioAssign(false);
    }
  }

  async function handleDeleteBio(id: string) {
    await deleteBio(id);
    await loadBios();
  }

  async function submitCta() {
    const text = newCtaText.trim();
    if (!text) return;
    if (!newCtaAll && newCtaEmployees.size === 0) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    try {
      await addCta({
        id: crypto.randomUUID(),
        text: newCtaText,
        employees: newCtaAll ? [] : [...newCtaEmployees],
        allEmployees: newCtaAll,
        createdAt: Date.now(),
      });
      await loadCtas();
      setNewCtaText('');
      setNewCtaEmployees(new Set());
      setNewCtaAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add CTA.');
    }
  }

  function toggleCtaEmployee(username: string) {
    setNewCtaEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleDeleteCta(id: string) {
    await deleteCta(id);
    await loadCtas();
  }

  function startEditMetaSessionsLink() {
    setMetaSessionsDraft(metaSessionsLink?.url ?? '');
    setEditingMetaSessionsLink(true);
  }

  function cancelEditMetaSessionsLink() {
    setEditingMetaSessionsLink(false);
    setMetaSessionsDraft('');
  }

  async function saveMetaSessionsLink() {
    const url = metaSessionsDraft.trim();
    if (!url) {
      setError('Enter a sessions link URL.');
      return;
    }
    setSavingMetaSessionsLink(true);
    try {
      const link: ApiLink = {
        id: META_SESSIONS_LINK_ID,
        label: META_SESSIONS_LINK_LABEL,
        url,
        updatedAt: Date.now(),
      };
      await saveApiLink(link);
      setMetaSessionsLink(link);
      setEditingMetaSessionsLink(false);
      setMetaSessionsDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save sessions link.');
    } finally {
      setSavingMetaSessionsLink(false);
    }
  }

  function openMetaSessionsLink() {
    if (!metaSessionsLink?.url) return;
    const href = externalHref(metaSessionsLink.url);
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  async function submitStory() {
    const text = newStoryText.trim();
    if (!text) return;
    if (!newStoryAll && newStoryEmployees.size === 0) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    try {
      await addStory({
        id: crypto.randomUUID(),
        text: newStoryText,
        employees: newStoryAll ? [] : [...newStoryEmployees],
        allEmployees: newStoryAll,
        createdAt: Date.now(),
      });
      await loadStories();
      setNewStoryText('');
      setNewStoryEmployees(new Set());
      setNewStoryAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add story.');
    }
  }

  function toggleStoryEmployee(username: string) {
    setNewStoryEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleDeleteStory(id: string) {
    await deleteStory(id);
    await loadStories();
  }

  async function uploadContentFiles(files: File[]) {
    if (files.length === 0) return;
    if (contentTab === 'carousel') {
      if (files.length < MIN_CAROUSEL_ITEMS) {
        setError(`Carousels need at least ${MIN_CAROUSEL_ITEMS} items.`);
        return;
      }
      if (files.length > MAX_CAROUSEL_ITEMS) {
        setError(`Carousels can have at most ${MAX_CAROUSEL_ITEMS} items.`);
        return;
      }
    }

    const invalid = files.find(
      (file) => !isImageFile(file, file.name) && !isVideoFile(file, file.name),
    );
    if (invalid) {
      setError(`Unsupported file type: ${invalid.name || 'unknown'}`);
      return;
    }

    setUploadingContent(true);
    try {
      await addContent(
        {
          id: crypto.randomUUID(),
          caption: '',
          videoUrl: '',
          mediaType: contentTab,
          employees: [],
          allEmployees: false,
          targetAccount: undefined,
          scheduledAt: undefined,
          createdAt: Date.now(),
        },
        contentTab === 'carousel' ? files : files[0],
      );
      await loadContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload content.');
    } finally {
      setUploadingContent(false);
    }
  }

  function toggleContentEmployee(username: string) {
    setNewContentEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function handleDeleteContent(id: string) {
    await deleteContent(id);
    await loadContent();
  }

  async function handleUnscheduleContent(reel: ContentReel, scheduledPostId: string) {
    const next = normalizeScheduledPosts(reel).filter((post) => post.id !== scheduledPostId);
    await updateContent({
      ...reel,
      scheduledPosts: next,
      scheduledAt: undefined,
      targetAccount: undefined,
      postError: undefined,
      publishingAt: undefined,
      publishStage: undefined,
    });
    await loadContent();
  }

  function openScheduleModal(reel: ContentReel, mode: 'post' | 'schedule') {
    setScheduleReel(reel);
    setScheduleMode(mode);
    setNewContentCaption(reel.caption ?? '');
    setNewContentTarget('');
    setNewContentProxyId('');
    setNewContentScheduledAt(mode === 'schedule' ? nowDatetimeLocal() : '');
    setPublishProgress(
      isContentPublishing(reel)
        ? {
            stage:
              reel.publishStage ??
              reel.scheduledPosts?.find((post) => post.publishingAt)?.publishStage ??
              'creating',
          }
        : null,
    );
  }

  function closeScheduleModal() {
    setScheduleReel(null);
    setNewContentCaption('');
    setNewContentTarget('');
    setNewContentProxyId('');
    setNewContentScheduledAt('');
    setPublishProgress(null);
  }

  async function publishReelToAccount(
    reel: ContentReel,
    caption: string,
    targetUsername: string,
    proxyId: string | undefined,
    onProgress?: (progress: PublishProgress) => void,
  ) {
    const account = accounts.find((a) => a.username === targetUsername);
    if (!account?.igUserId || !account?.igAccessToken) {
      throw new Error('The selected Instagram account has no saved API token / User ID.');
    }
    const mediaUrls = getContentMediaUrls(reel);
    if (!mediaUrls.length) {
      throw new Error('This item has no uploaded media to publish.');
    }
    const proxyRecord = proxyId ? proxies.find((p) => p.id === proxyId) : undefined;
    const relayProxy = proxyRecord ? proxyToRelayConfig(proxyRecord) : undefined;
    if (proxyId && !relayProxy) {
      throw new Error('The selected proxy could not be parsed. Check host, port, and credentials.');
    }
    return publishContent(
      account.igUserId,
      account.igAccessToken,
      {
        mediaType: reel.mediaType ?? 'reel',
        mediaUrls,
        caption: reel.mediaType === 'story' ? '' : caption,
        proxy: relayProxy,
      },
      onProgress,
    );
  }

  async function persistPublishProgress(reel: ContentReel, progress: PublishProgress) {
    if (!progress.stage || progress.stage === 'done') return;
    await updateContent({
      ...reel,
      publishingAt: reel.publishingAt ?? Date.now(),
      publishStage: progress.stage,
      postError: undefined,
    });
  }

  async function saveSchedule() {
    if (!scheduleReel) return;

    if (scheduleMode === 'post') {
      if (!newContentTarget) {
        setError('Select an Instagram account to post to.');
        return;
      }
      setSavingSchedule(true);
      setPublishProgress({ stage: 'creating' });
      const publishingReel: ContentReel = {
        ...scheduleReel,
        mediaType: scheduleReel.mediaType ?? 'reel',
        publishingAt: Date.now(),
        publishStage: 'creating',
        postError: undefined,
        postedAt: undefined,
        permalink: undefined,
      };
      try {
        await updateContent(publishingReel);
        await loadContent();

        const result = await publishReelToAccount(
          publishingReel,
          newContentCaption,
          newContentTarget,
          newContentProxyId || undefined,
          async (progress) => {
            setPublishProgress(progress);
            await persistPublishProgress(publishingReel, progress);
            await loadContent();
          },
        );
        const now = Date.now();
        await updateContent({
          ...publishingReel,
          mediaType: scheduleReel.mediaType ?? 'reel',
          caption: newContentCaption,
          targetAccount: newContentTarget,
          proxyId: newContentProxyId || undefined,
          scheduledAt: undefined,
          postedAt: now,
          permalink: result.permalink,
          postError: undefined,
          publishingAt: undefined,
          publishStage: undefined,
          postHistory: [
            ...(scheduleReel.postHistory ?? []),
            { account: newContentTarget, postedAt: now, permalink: result.permalink },
          ],
        });
        await loadContent();
        closeScheduleModal();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not publish to Instagram.';
        await updateContent({
          ...publishingReel,
          postedAt: scheduleReel.postedAt,
          permalink: scheduleReel.permalink,
          publishingAt: undefined,
          publishStage: undefined,
          postError: message,
        });
        await loadContent();
        setError(message);
      } finally {
        setSavingSchedule(false);
        setPublishProgress(null);
      }
      return;
    }

    setSavingSchedule(true);
    try {
      if (!newContentTarget) {
        setError('Select an Instagram account to schedule.');
        return;
      }
      if (!newContentScheduledAt) {
        setError('Pick a date and time to schedule.');
        return;
      }

      const existing = normalizeScheduledPosts(scheduleReel);
      const newEntry = {
        id: crypto.randomUUID(),
        account: newContentTarget,
        scheduledAt: parseDatetimeLocal(newContentScheduledAt),
        caption: newContentCaption || undefined,
        proxyId: newContentProxyId || undefined,
      };

      await updateContent({
        ...scheduleReel,
        caption: newContentCaption,
        scheduledPosts: [...existing, newEntry],
        scheduledAt: undefined,
        targetAccount: undefined,
        proxyId: undefined,
        postError: undefined,
      });
      await loadContent();
      closeScheduleModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update content.');
    } finally {
      setSavingSchedule(false);
    }
  }

  function openAssignModal(reel: ContentReel) {
    setAssignReel(reel);
    setNewContentEmployees(new Set(reel.employees ?? []));
    setNewContentAll(Boolean(reel.allEmployees));
  }

  function closeAssignModal() {
    setAssignReel(null);
    setNewContentEmployees(new Set());
    setNewContentAll(false);
  }

  async function saveAssign() {
    if (!assignReel) return;
    setSavingAssign(true);
    try {
      await updateContent({
        ...assignReel,
        employees: newContentAll ? [] : [...newContentEmployees],
        allEmployees: newContentAll,
      });
      await loadContent();
      closeAssignModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign content.');
    } finally {
      setSavingAssign(false);
    }
  }

  async function downloadReel(reel: ContentReel) {
    const urls = getContentMediaUrls(reel);
    if (!urls.length) return;
    const ext =
      reel.mediaType === 'image' ||
      reel.mediaType === 'carousel' ||
      (reel.mediaType === 'story' && !isStoryVideo(reel))
        ? 'jpg'
        : 'mp4';
    try {
      for (let i = 0; i < urls.length; i++) {
        const res = await fetch(urls[i]);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reel.mediaType ?? 'reel'}-${reel.id}${urls.length > 1 ? `-${i + 1}` : ''}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      window.open(urls[0], '_blank', 'noopener');
    }
  }

  function toggleAddForm(key: string) {
    setOpenAddForms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openEditProxy(proxy: Proxy) {
    setEditItem({
      kind: 'proxy',
      id: proxy.id,
      createdAt: proxy.createdAt,
      text: proxy.raw,
      rotating: proxy.rotatingLink,
      type: proxy.type,
      employees: new Set(assignedEmployees(proxy)),
      allEmployees: proxy.allEmployees,
    });
  }

  function openEditLicense(license: License) {
    setEditItem({
      kind: 'license',
      id: license.id,
      createdAt: license.createdAt,
      text: license.license,
      rotating: '',
      type: 'http',
      employees: new Set(assignedEmployees(license)),
      allEmployees: license.allEmployees,
    });
  }

  function openEditBio(bio: Bio) {
    setEditItem({
      kind: 'bio',
      id: bio.id,
      createdAt: bio.createdAt,
      text: bio.text,
      rotating: '',
      type: 'http',
      employees: new Set(bio.employees),
      allEmployees: bio.allEmployees,
    });
  }

  function openEditCta(cta: Cta) {
    setEditItem({
      kind: 'cta',
      id: cta.id,
      createdAt: cta.createdAt,
      text: cta.text,
      rotating: '',
      type: 'http',
      employees: new Set(cta.employees),
      allEmployees: cta.allEmployees,
    });
  }

  function openEditStory(story: StoryNote) {
    setEditItem({
      kind: 'story',
      id: story.id,
      createdAt: story.createdAt,
      text: story.text,
      rotating: '',
      type: 'http',
      employees: new Set(story.employees),
      allEmployees: story.allEmployees,
    });
  }

  function toggleEditEmployee(username: string) {
    setEditItem((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.employees);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return { ...prev, employees: next };
    });
  }

  async function saveEdit() {
    if (!editItem) return;
    const text = editItem.text.trim();
    if (!text) return;
    if (
      editItem.kind !== 'bio' &&
      !editItem.allEmployees &&
      editItem.employees.size === 0
    ) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    const employees = editItem.allEmployees ? [] : [...editItem.employees];
    try {
      if (editItem.kind === 'proxy') {
        const parsed = parseProxyString(text);
        if (!parsed) {
          setError('Could not parse that proxy.');
          return;
        }
        await addProxy({
          id: editItem.id,
          raw: text,
          type: editItem.type,
          host: parsed.host,
          port: parsed.port,
          username: parsed.user,
          password: parsed.pass,
          rotatingLink: editItem.rotating.trim(),
          employees,
          allEmployees: editItem.allEmployees,
          createdAt: editItem.createdAt,
        });
        await loadProxies();
      } else if (editItem.kind === 'license') {
        await addLicense({
          id: editItem.id,
          license: text,
          employees,
          allEmployees: editItem.allEmployees,
          createdAt: editItem.createdAt,
        });
        await loadLicenses();
      } else if (editItem.kind === 'bio') {
        await addBio({
          id: editItem.id,
          text: editItem.text,
          employees,
          allEmployees: editItem.allEmployees,
          createdAt: editItem.createdAt,
        });
        await loadBios();
      } else if (editItem.kind === 'story') {
        await addStory({
          id: editItem.id,
          text: editItem.text,
          employees,
          allEmployees: editItem.allEmployees,
          createdAt: editItem.createdAt,
        });
        await loadStories();
      } else {
        await addCta({
          id: editItem.id,
          text: editItem.text,
          employees,
          allEmployees: editItem.allEmployees,
          createdAt: editItem.createdAt,
        });
        await loadCtas();
      }
      setEditItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    }
  }

  async function handleSaveCredentials(values: {
    loginUsername: string;
    loginEmail: string;
    loginPhone: string;
    loginPassword: string;
    authSecret: string;
    igUserId: string;
    igAccessToken: string;
  }) {
    if (!selectedAccount) return;
    const updated: TrackedAccount = {
      ...selectedAccount,
      loginUsername: values.loginUsername || undefined,
      loginEmail: values.loginEmail || undefined,
      loginPhone: values.loginPhone || undefined,
      loginPassword: values.loginPassword || undefined,
      authSecret: values.authSecret || undefined,
      igUserId: values.igUserId || undefined,
      igAccessToken: values.igAccessToken || undefined,
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

  const availableProxies = useMemo(() => {
    if (!session) return [];
    if (isAdmin) return proxies;
    return proxies.filter(
      (p) => p.allEmployees || p.employees.includes(session.username),
    );
  }, [proxies, isAdmin, session]);

  const myAccountUsernames = useMemo(
    () => new Set(accounts.map((a) => a.username)),
    [accounts],
  );

  if (!session) {
    return (
      <Login
        onSuccess={(next) => {
          localStorage.setItem('drbossing_session', JSON.stringify(next));
          localStorage.removeItem('drbossing_auth');
          const nextPlatform = next.platform ?? 'instagram';
          setView('dashboard');
          setSelectedEmployee(null);
          setPlatform(nextPlatform);
          setLoading(nextPlatform === 'instagram');
          setSession(next);
        }}
      />
    );
  }

  if (loading && platform === 'instagram') {
    return <div className="app app--centered"><p>Loading Dr. Bossing…</p></div>;
  }

  function handleLock() {
    localStorage.removeItem('drbossing_session');
    localStorage.removeItem('drbossing_auth');
    setSession(null);
    setPlatform('instagram');
    setEmployees([]);
    setSelectedEmployee(null);
    setError(null);
    setWarning(null);
    setRefreshAllProgress(null);
    setRefreshing(null);
    setFailedRefresh(new Set());
  }

  const topbarTitle =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'employees'
        ? 'Employees'
        : view === 'employee'
        ? `Employee · ${selectedEmployee ?? ''}`
        : view === 'license'
          ? 'Blaze License'
          : view === 'proxy'
            ? 'Proxy'
            : view === 'api'
              ? 'API'
              : view === 'bio'
              ? 'Account Bio'
              : view === 'cta'
                ? 'CTA'
                : view === 'content'
                    ? 'Content'
                    : view === 'schedule'
                      ? 'Schedule'
                      : 'Accounts';

  const showAddForm = view === 'accounts';

  const postableAccounts = accounts.filter((a) => a.igUserId && a.igAccessToken);

  const displayedContent = (() => {
    let list = content.filter((reel) => (reel.mediaType ?? 'reel') === contentTab);
    if (isAdmin && contentEmployeeFilter) {
      list = list.filter(
        (reel) => reel.allEmployees || reel.employees.includes(contentEmployeeFilter),
      );
    }
    return list;
  })();

  const scheduledForDate = (() => {
    let scheduled = getScheduledPostsForDate(content, scheduleViewDate);
    if (scheduleFilterTab !== 'all') {
      scheduled = scheduled.filter(
        ({ reel }) => (reel.mediaType ?? 'reel') === scheduleFilterTab,
      );
    }
    if (isAdmin && contentEmployeeFilter) {
      scheduled = scheduled.filter(
        ({ reel }) => reel.allEmployees || reel.employees.includes(contentEmployeeFilter),
      );
    }
    if (!isAdmin) {
      scheduled = scheduled.filter(({ scheduledPost }) =>
        myAccountUsernames.has(scheduledPost.account),
      );
    }
    return scheduled;
  })();

  const scheduleViewLabel = formatDateLocal(parseDatetimeLocal(`${scheduleViewDate}T12:00`));

  const isScheduleViewToday = scheduleViewDate === toDateKey(Date.now());

  const searchWords = accountSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredAccounts =
    searchWords.length > 0
      ? accounts.filter((a) => {
          const haystack = `${a.username} ${a.fullName ?? ''}`.toLowerCase();
          return searchWords.every((word) => haystack.includes(word));
        })
      : accounts;

  const loadingBlock = (
    <div className="loading-block">
      <span className="spinner" aria-hidden />
      <span>Loading accounts…</span>
    </div>
  );

  return (
    <>
      {session && (
        <div
          className={
            platform === 'bluesky' ? 'platform-panel' : 'platform-panel platform-panel--hidden'
          }
          aria-hidden={platform !== 'bluesky'}
        >
          <BlueskySection
            session={session}
            isAdmin={isAdmin}
            canSwitch={isAdmin}
            onSwitchToInstagram={() => setPlatform('instagram')}
            onLock={handleLock}
          />
        </div>
      )}
      <div
        className={
          platform === 'instagram' ? 'platform-panel' : 'platform-panel platform-panel--hidden'
        }
        aria-hidden={platform !== 'instagram'}
      >
    <div className="app-shell app-shell--instagram">
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

        {isAdmin && (
          <div className="platform-switch">
            <button type="button" className="platform-switch__btn platform-switch__btn--active">
              Instagram
            </button>
            <button
              type="button"
              className="platform-switch__btn"
              onClick={() => setPlatform('bluesky')}
            >
              Bluesky
            </button>
          </div>
        )}

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

          <button
            type="button"
            className={view === 'license' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('license');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2 4.5 12.5h6L9 22l9.5-12h-6z" />
            </svg>
            Blaze License
          </button>

          <button
            type="button"
            className={view === 'proxy' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('proxy');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
            Proxy
          </button>

          <button
            type="button"
            className={view === 'api' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('api');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 9h8M8 13h6" />
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M7 4V2.5M17 4V2.5" />
            </svg>
            API
          </button>

          <button
            type="button"
            className={view === 'bio' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('bio');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
            </svg>
            Account Bio
          </button>

          <button
            type="button"
            className={view === 'cta' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('cta');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 11l18-7-7 18-2.5-7.5z" />
            </svg>
            CTA
          </button>

          <button
            type="button"
            className={view === 'content' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('content');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
            </svg>
            Content
          </button>

          <button
            type="button"
            className={view === 'schedule' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('schedule');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
              <path d="M8 3v4M16 3v4" />
            </svg>
            Schedule
          </button>

          {isAdmin && (
            <button
              type="button"
              className={
                view === 'employees' || view === 'employee'
                  ? 'nav-item nav-item--active'
                  : 'nav-item'
              }
              onClick={() => {
                setSelectedEmployee(null);
                setView('employees');
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3.5 19c0-3 2.7-5 5.5-5s5.5 2 5.5 5" />
                <path d="M16 5.2a3 3 0 0 1 0 5.6" />
                <path d="M18 14c2.2.4 3.8 2.2 3.8 4.6" />
              </svg>
              Employees
            </button>
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
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setSelectedEmployee(null);
                    setView('employees');
                  }}
                >
                  ‹ All employees
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => handleDeleteEmployee(selectedEmployee)}
                >
                  Remove employee
                </button>
              </>
            )}
            {(view === 'accounts' || view === 'employee') && accounts.length > 0 && (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={Boolean(refreshing) || Boolean(refreshAllProgress)}
                onClick={handleRefreshAll}
              >
                {refreshAllProgress ? 'Refreshing…' : 'Refresh all'}
              </button>
            )}
          </div>
        </header>

        {!apiReady && (
          <div className="banner banner--warn">
            Set <code>APIFY_TOKEN</code> in Vercel to fetch Instagram data via Apify, then redeploy.
          </div>
        )}

        {error && (
          <div className="banner banner--error banner--dismissible">
            <span>{error}</span>
            <button
              type="button"
              className="banner__close"
              onClick={() => setError(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {warning && !error && (
          <div className="banner banner--warn banner--dismissible">
            <span>{warning}</span>
            <button
              type="button"
              className="banner__close"
              onClick={() => setWarning(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {publishingContent.length > 0 && (
          <div className="banner banner--publish">
            <PublishProgressBar
              stage={
                publishingContent[0].publishStage ??
                publishingContent[0].scheduledPosts?.find((post) => post.publishingAt)?.publishStage ??
                'creating'
              }
            />
            <span className="publish-banner__meta">
              Posting {publishingContent.length} item{publishingContent.length === 1 ? '' : 's'}
              {(() => {
                const item = publishingContent[0];
                const account =
                  item.targetAccount ??
                  item.scheduledPosts?.find((post) => post.publishingAt)?.account;
                return account ? ` to @${account}` : '';
              })()}
              …
            </span>
          </div>
        )}

        {refreshAllProgress && (
          <div className="refresh-progress">
            <div className="refresh-progress__track">
              <div
                className="refresh-progress__fill"
                style={{
                  width: `${Math.round(
                    (refreshAllProgress.done / refreshAllProgress.total) * 100,
                  )}%`,
                }}
              />
            </div>
            <span className="refresh-progress__label">
              Refreshing {refreshAllProgress.done}/{refreshAllProgress.total} (
              {Math.round((refreshAllProgress.done / refreshAllProgress.total) * 100)}%)
            </span>
          </div>
        )}

        {view === 'dashboard' && dashboardRefreshing && accounts.length > 0 && (
          <div className="refresh-progress refresh-progress--inline" role="status">
            <span className="spinner spinner--sm" aria-hidden />
            <span className="refresh-progress__label">Refreshing dashboard…</span>
          </div>
        )}

        {view === 'dashboard' &&
          (accountsLoading && accounts.length === 0 ? (
            <section className="panel">{loadingBlock}</section>
          ) : accounts.length > 0 ? (
            <Dashboard
              accounts={accounts}
              reelSnapshots={scopedReelSnapshots}
              followerSnapshots={scopedFollowerSnapshots}
              employees={isAdmin ? employees : undefined}
              topMode={isAdmin ? 'admin' : 'employee'}
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

        {view === 'employees' && isAdmin && (
          <section className="panel">
            <div className="panel-head">
              <h2>Employees ({employees.length})</h2>
              <button
                type="button"
                className="btn"
                onClick={() => setShowAddEmployee(true)}
              >
                + Add new employee
              </button>
            </div>
            {employees.length === 0 ? (
              <p className="empty-note">
                No employees yet. Add one to start tracking their accounts and stats.
              </p>
            ) : (
              <div className="employee-grid">
                {employees.map((employee) => (
                  <button
                    key={employee.username}
                    type="button"
                    className="employee-card"
                    onClick={() => {
                      setSelectedEmployee(employee.username);
                      setView('employee');
                    }}
                  >
                    <span className="employee-card__avatar" aria-hidden>
                      {employee.username.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="employee-card__info">
                      <strong className="employee-card__name">{employee.username}</strong>
                      <span className="employee-card__meta">
                        {employeeAccountCounts[employee.username] ?? 0} account
                        {(employeeAccountCounts[employee.username] ?? 0) === 1 ? '' : 's'}
                        {' · joined '}
                        {formatDate(employee.createdAt)}
                      </span>
                    </span>
                    <span className="employee-card__chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {view === 'license' && (
          <>
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Add license</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('license') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('license')}
                    title={openAddForms.has('license') ? 'Hide' : 'Add license'}
                    aria-label={openAddForms.has('license') ? 'Hide' : 'Add license'}
                  >
                    {openAddForms.has('license') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('license') && (
                <form className="bio-form" onSubmit={handleAddLicense}>
                  <input
                    className="cred-form__input"
                    placeholder="License key"
                    value={newLicense}
                    onChange={(e) => setNewLicense(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <AssignmentPicker
                    employees={employees}
                    selected={newLicenseEmployees}
                    all={newLicenseAll}
                    onToggle={toggleLicenseEmployee}
                    onAllChange={setNewLicenseAll}
                  />
                  <button
                    type="submit"
                    disabled={!newLicense.trim() || (!newLicenseAll && newLicenseEmployees.size === 0)}
                  >
                    Add license
                  </button>
                </form>
                )}
              </section>
            )}

            <section className="panel">
              <h2>{isAdmin ? `Licenses (${licenses.length})` : 'Your Blaze License'}</h2>
              {licenses.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? 'No licenses yet. Add one above and assign it to an employee.'
                    : 'No license assigned to you yet.'}
                </p>
              ) : (
                <div className="license-list">
                  {licenses.map((license) => (
                    <div key={license.id} className="license-row">
                      <div className="license-row__info">
                        <code className="license-row__key">{license.license}</code>
                        {isAdmin &&
                          (license.allEmployees ? (
                            <span className="owner-tag">All employees</span>
                          ) : (
                            assignedEmployees(license).map((u) => (
                              <span key={u} className="owner-tag">
                                {u}
                              </span>
                            ))
                          ))}
                      </div>
                      <div className="row-actions">
                        <CopyButton value={license.license} title="Copy license" />
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="row-edit"
                              onClick={() => openEditLicense(license)}
                              title="Edit license"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteLicense(license.id)}
                              title="Delete license"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'cta' && (
          <>
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Add CTA</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('cta') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('cta')}
                    title={openAddForms.has('cta') ? 'Hide' : 'Add CTA'}
                    aria-label={openAddForms.has('cta') ? 'Hide' : 'Add CTA'}
                  >
                    {openAddForms.has('cta') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('cta') && (
                <form
                  className="bio-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitCta();
                  }}
                >
                  <textarea
                    className="bio-form__textarea"
                    placeholder="Insert a text or link…"
                    value={newCtaText}
                    onChange={(e) => setNewCtaText(e.target.value)}
                    rows={4}
                  />

                  <AssignmentPicker
                    employees={employees}
                    selected={newCtaEmployees}
                    all={newCtaAll}
                    onToggle={toggleCtaEmployee}
                    onAllChange={setNewCtaAll}
                  />

                  <button
                    type="submit"
                    disabled={!newCtaText.trim() || (!newCtaAll && newCtaEmployees.size === 0)}
                  >
                    Add CTA
                  </button>
                </form>
                )}
              </section>
            )}

            <section className="panel">
              <h2>{isAdmin ? `CTAs (${ctas.length})` : 'Your CTAs'}</h2>
              {ctas.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? 'No CTAs yet. Add one above and assign it to employees.'
                    : 'No CTA assigned to you yet.'}
                </p>
              ) : (
                <div className="bio-list">
                  {ctas.map((cta) => (
                    <div key={cta.id} className="bio-row">
                      <div className="bio-row__body">
                        <p className="bio-row__text">{cta.text}</p>
                        {isAdmin && (
                          <div className="bio-row__assign">
                            {cta.allEmployees ? (
                              <span className="owner-tag">All employees</span>
                            ) : (
                              cta.employees.map((u) => (
                                <span key={u} className="owner-tag">
                                  {u}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <div className="row-actions">
                        <CopyButton value={cta.text} title="Copy CTA" />
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="row-edit"
                              onClick={() => openEditCta(cta)}
                              title="Edit CTA"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteCta(cta.id)}
                              title="Delete CTA"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'bio' && (
          <>
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Add account bio</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('bio') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('bio')}
                    title={openAddForms.has('bio') ? 'Hide' : 'Add bio'}
                    aria-label={openAddForms.has('bio') ? 'Hide' : 'Add bio'}
                  >
                    {openAddForms.has('bio') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('bio') && (
                <form
                  className="bio-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitBio();
                  }}
                >
                  <textarea
                    className="bio-form__textarea"
                    placeholder="Write the bio…"
                    value={newBioText}
                    onChange={(e) => setNewBioText(e.target.value)}
                    rows={4}
                  />

                  <button
                    type="submit"
                    disabled={!newBioText.trim()}
                  >
                    Add bio
                  </button>
                </form>
                )}
              </section>
            )}

            <section className="panel">
              <h2>{isAdmin ? `Bios (${bios.length})` : 'Your account bios'}</h2>
              {bios.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? 'No bios yet. Write one above and assign it to employees.'
                    : 'No bio assigned to you yet.'}
                </p>
              ) : (
                <div className="bio-list">
                  {bios.map((bio) => (
                    <div key={bio.id} className="bio-row">
                      <div className="bio-row__body">
                        <p className="bio-row__text">{bio.text}</p>
                        {isAdmin && (
                          <div className="bio-row__assign">
                            {bio.allEmployees ? (
                              <span className="owner-tag">All employees</span>
                            ) : (
                              bio.employees.map((u) => (
                                <span key={u} className="owner-tag">
                                  {u}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <div className="row-actions">
                        <CopyButton value={bio.text} title="Copy bio" />
                        {isAdmin && (
                          <button
                            type="button"
                            className="row-edit bio-row__push"
                            onClick={() => openAssignBioModal(bio)}
                            title="Assign to employees"
                          >
                            Assign
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="row-edit"
                              onClick={() => openEditBio(bio)}
                              title="Edit bio"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteBio(bio.id)}
                              title="Delete bio"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'content' && (
          <>
            <div className="toggle-group content-tabs">
              {(['reel', 'image', 'story', 'carousel'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`toggle ${contentTab === tab ? 'toggle--active' : ''}`}
                  onClick={() => {
                    setContentTab(tab);
                    if (contentFileRef.current) contentFileRef.current.value = '';
                  }}
                >
                  {contentTabLabel(tab)}
                </button>
              ))}
            </div>

            {isAdmin && (
              <input
                ref={contentFileRef}
                type="file"
                accept={ALL_MEDIA_ACCEPT}
                multiple={contentTab === 'carousel'}
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length) void uploadContentFiles(files);
                  e.target.value = '';
                }}
              />
            )}

            <section className="panel">
              <div className="panel-head">
                <h2>
                  {isAdmin
                    ? `${contentTabLabel(contentTab)} (${displayedContent.length})`
                    : `Your ${contentTabSingular(contentTab)}s`}
                </h2>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => contentFileRef.current?.click()}
                    disabled={uploadingContent}
                  >
                    {uploadingContent
                      ? 'Uploading…'
                      : contentTab === 'carousel'
                        ? 'Add carousel'
                        : `Add ${contentTabSingular(contentTab)}`}
                  </button>
                )}
              </div>
              {displayedContent.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? contentTab === 'carousel'
                      ? `No carousels yet. Upload ${MIN_CAROUSEL_ITEMS}–${MAX_CAROUSEL_ITEMS} images or videos to create one.`
                      : `No ${contentTabSingular(contentTab)}s yet. Upload one above and assign it to employees.`
                    : `No ${contentTabSingular(contentTab)} assigned to you yet.`}
                </p>
              ) : (
                <div className="reels-grid">
                  {displayedContent.map((reel) => (
                    <div key={reel.id} className="reel-cell">
                      <ContentMediaPreview reel={reel} />
                      <div className="reel-cell__overlay">
                        <button
                          type="button"
                          className="reel-cell__btn reel-cell__btn--wide"
                          onClick={() => setHistoryReel(reel)}
                          title="Post history"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          className="reel-cell__btn reel-cell__btn--wide"
                          onClick={() => downloadReel(reel)}
                          title={`Download ${contentTabSingular(reel.mediaType ?? 'reel')}`}
                        >
                          Download
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            className="reel-cell__btn reel-cell__btn--wide"
                            onClick={() => openAssignModal(reel)}
                            title="Assign to employees"
                            aria-label="Assign to employees"
                          >
                            Assign
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            className="reel-cell__btn reel-cell__btn--danger"
                            onClick={() => handleDeleteContent(reel.id)}
                            title={`Delete ${contentTabSingular(reel.mediaType ?? 'reel')}`}
                            aria-label="Delete"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="reel-cell__footer">
                        <button
                          type="button"
                          className="reel-cell__action reel-cell__action--primary"
                          onClick={() => openScheduleModal(reel, 'post')}
                          disabled={isContentPublishing(reel)}
                        >
                          Post
                        </button>
                        <button
                          type="button"
                          className="reel-cell__action reel-cell__action--secondary"
                          onClick={() => openScheduleModal(reel, 'schedule')}
                          disabled={isContentPublishing(reel)}
                        >
                          Schedule
                        </button>
                      </div>
                      {isContentPublishing(reel) && (
                        <div className="reel-cell__progress">
                          <PublishProgressBar
                            stage={
                              reel.publishStage ??
                              reel.scheduledPosts?.find((post) => post.publishingAt)?.publishStage ??
                              'creating'
                            }
                          />
                        </div>
                      )}
                      {reel.postError && !isContentPublishing(reel) && (
                        <div className="reel-cell__error" title={reel.postError}>
                          ⚠ Post failed
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'schedule' && (
          <section className="panel">
            <div className="panel-head schedule-head">
              <h2>
                {scheduleViewLabel}
                {isScheduleViewToday && <span className="schedule-head__today"> · Today</span>}
                <span className="content-filter__active schedule-head__tz"> · {timezoneLabel}</span>
                <span className="content-filter__active">
                  {' '}
                  · {scheduledForDate.length} item{scheduledForDate.length === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="schedule-controls">
                {isAdmin && (
                  <select
                    className="content-filter__date"
                    value={contentEmployeeFilter}
                    onChange={(e) => setContentEmployeeFilter(e.target.value)}
                    title="Filter by employee"
                  >
                    <option value="">All employees</option>
                    {employees.map((emp) => (
                      <option key={emp.username} value={emp.username}>
                        {emp.username}
                      </option>
                    ))}
                  </select>
                )}
                <div className="schedule-datenav">
                  <button
                    type="button"
                    className="content-filter__nav"
                    onClick={() => setScheduleViewDate((d) => shiftDateKey(d, -1))}
                    title="Previous day"
                    aria-label="Previous day"
                  >
                    ‹
                  </button>
                  <input
                    type="date"
                    className="content-filter__date"
                    value={scheduleViewDate}
                    onChange={(e) =>
                      setScheduleViewDate(e.target.value || toDateKey(Date.now()))
                    }
                    title="Pick a date"
                  />
                  <button
                    type="button"
                    className="content-filter__nav"
                    onClick={() => setScheduleViewDate((d) => shiftDateKey(d, 1))}
                    title="Next day"
                    aria-label="Next day"
                  >
                    ›
                  </button>
                  {!isScheduleViewToday && (
                    <button
                      type="button"
                      className="content-filter__clear"
                      onClick={() => setScheduleViewDate(toDateKey(Date.now()))}
                    >
                      Today
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="toggle-group schedule-tabs">
              <button
                type="button"
                className={`toggle ${scheduleFilterTab === 'all' ? 'toggle--active' : ''}`}
                onClick={() => setScheduleFilterTab('all')}
              >
                All
              </button>
              {(['reel', 'image', 'story', 'carousel'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`toggle ${scheduleFilterTab === tab ? 'toggle--active' : ''}`}
                  onClick={() => setScheduleFilterTab(tab)}
                >
                  {contentTabLabel(tab)}
                </button>
              ))}
            </div>

            {scheduledForDate.length === 0 ? (
              <p className="empty-note">
                Nothing scheduled for {scheduleViewLabel}.
              </p>
            ) : (
              <div className="schedule-groups">
                <div className="schedule-group">
                  <div className="schedule-list">
                    {scheduledForDate.map(({ reel, scheduledPost }) => (
                        <div key={`${reel.id}-${scheduledPost.id}`} className="schedule-card">
                          <ContentMediaPreview reel={reel} compact />
                          <div className="schedule-card__body">
                            <div className="schedule-card__top">
                              <span className="schedule-card__time">
                                🗓 {formatTimeLocal(scheduledPost.scheduledAt)}
                              </span>
                              <span className="schedule-card__type">
                                {contentMediaLabel(reel.mediaType)}
                              </span>
                            </div>
                            {(scheduledPost.caption ?? reel.caption) ? (
                              <p className="schedule-card__caption">
                                {scheduledPost.caption ?? reel.caption}
                              </p>
                            ) : (
                              <p className="schedule-card__caption schedule-card__caption--empty">
                                No caption
                              </p>
                            )}
                            <p className="schedule-card__target">📲 Post on @{scheduledPost.account}</p>
                            {scheduledPost.proxyId && (() => {
                              const proxy = proxies.find((p) => p.id === scheduledPost.proxyId);
                              return proxy ? (
                                <p className="schedule-card__target">
                                  🌐 Proxy: {proxyOptionLabel(proxy)}
                                </p>
                              ) : null;
                            })()}
                            {scheduledPost.publishingAt && !scheduledPost.postedAt ? (
                              <div className="schedule-card__progress">
                                <PublishProgressBar stage={scheduledPost.publishStage ?? 'creating'} />
                              </div>
                            ) : scheduledPost.postedAt ? (
                              <p className="schedule-card__status schedule-card__status--posted">
                                ✓ Posted{' '}
                                {scheduledPost.permalink && (
                                  <a
                                    href={scheduledPost.permalink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    View
                                  </a>
                                )}
                              </p>
                            ) : scheduledPost.postError ? (
                              <p className="schedule-card__status schedule-card__status--error">
                                ⚠ {scheduledPost.postError}
                              </p>
                            ) : (
                              <p className="schedule-card__status">
                                Scheduled for {formatDateTimeLocal(scheduledPost.scheduledAt)}
                              </p>
                            )}
                            <div className="schedule-card__assign">
                              {reel.allEmployees ? (
                                <span className="owner-tag">All employees</span>
                              ) : reel.employees.length > 0 ? (
                                reel.employees.map((u) => (
                                  <span key={u} className="owner-tag">
                                    {u}
                                  </span>
                                ))
                              ) : (
                                <span className="owner-tag owner-tag--muted">Unassigned</span>
                              )}
                            </div>
                          </div>
                          <div className="schedule-card__actions">
                            <button
                              type="button"
                              className="content-tile__download"
                              onClick={() => downloadReel(reel)}
                              title={`Download ${contentTabSingular(reel.mediaType ?? 'reel')}`}
                            >
                              ↓ Download
                            </button>
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleUnscheduleContent(reel, scheduledPost.id)}
                              title="Remove from schedule"
                              aria-label="Remove from schedule"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'proxy' && (
          <>
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Add proxy</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('proxy') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('proxy')}
                    title={openAddForms.has('proxy') ? 'Hide' : 'Add proxy'}
                    aria-label={openAddForms.has('proxy') ? 'Hide' : 'Add proxy'}
                  >
                    {openAddForms.has('proxy') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('proxy') && (
                <>
                <form className="license-form" onSubmit={handleAddProxy}>
                  <input
                    className="cred-form__input"
                    placeholder="host:port:user:pass or user:pass@host:port"
                    value={newProxy}
                    onChange={(e) => setNewProxy(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <input
                    className="cred-form__input"
                    placeholder="Rotating link (optional)"
                    value={newProxyRotating}
                    onChange={(e) => setNewProxyRotating(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <select
                    className="cred-form__input license-form__select proxy-type-select"
                    value={newProxyType}
                    onChange={(e) => setNewProxyType(e.target.value)}
                  >
                    <option value="http">HTTP</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                  <AssignmentPicker
                    employees={employees}
                    selected={newProxyEmployees}
                    all={newProxyAll}
                    onToggle={toggleProxyEmployee}
                    onAllChange={setNewProxyAll}
                  />
                  <button
                    type="submit"
                    disabled={!newProxy.trim() || (!newProxyAll && newProxyEmployees.size === 0)}
                  >
                    Add proxy
                  </button>
                </form>
                {newProxy.trim() &&
                  (() => {
                    const parsed = parseProxyString(newProxy);
                    return parsed ? (
                      <div className="proxy-preview">
                        <span><b>IP:</b> {parsed.host || '—'}</span>
                        <span><b>Port:</b> {parsed.port || '—'}</span>
                        <span><b>Username:</b> {parsed.user || '—'}</span>
                        <span><b>Password:</b> {parsed.pass || '—'}</span>
                      </div>
                    ) : (
                      <p className="cred-note">Could not parse this proxy format.</p>
                    );
                  })()}
                </>
                )}
              </section>
            )}

            <section className="panel">
              <h2>{isAdmin ? `Proxies (${proxies.length})` : 'Your proxies'}</h2>
              {proxies.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? 'No proxies yet. Add one above and assign it to an employee.'
                    : 'No proxy assigned to you yet.'}
                </p>
              ) : (
                <div className="proxy-list">
                  {proxies.map((proxy) => (
                    <div key={proxy.id} className="proxy-row">
                      <div className="proxy-row__body">
                        <div className="proxy-row__top">
                          {isAdmin ? (
                            <select
                              className="proxy-type-edit"
                              value={proxy.type}
                              onChange={(e) => handleUpdateProxyType(proxy, e.target.value)}
                            >
                              <option value="http">HTTP</option>
                              <option value="socks5">SOCKS5</option>
                            </select>
                          ) : (
                            <span className={`proxy-type-tag proxy-type-tag--${proxy.type}`}>
                              {proxy.type.toUpperCase()}
                            </span>
                          )}
                          {isAdmin &&
                            (proxy.allEmployees ? (
                              <span className="owner-tag">All employees</span>
                            ) : (
                              assignedEmployees(proxy).map((u) => (
                                <span key={u} className="owner-tag">
                                  {u}
                                </span>
                              ))
                            ))}
                        </div>
                        <CopyField className="proxy-row__link" label="Link" value={proxy.raw} />
                        {proxy.rotatingLink && (
                          <CopyField
                            className="proxy-row__link"
                            label="Rotating link"
                            value={proxy.rotatingLink}
                          />
                        )}
                        <div className="proxy-row__fields">
                          <CopyField label="IP" value={proxy.host} />
                          <CopyField label="Port" value={proxy.port} />
                          <CopyField label="Username" value={proxy.username} />
                          <CopyField label="Password" value={proxy.password} />
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="row-edit"
                            onClick={() => openEditProxy(proxy)}
                            title="Edit proxy"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="license-row__delete"
                            onClick={() => handleDeleteProxy(proxy.id)}
                            title="Delete proxy"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'api' && (
          <section className="panel">
            <h2>API</h2>
            <div className="api-links-grid">
              <div className="api-bubble-card">
                <div className="api-bubble-card__head">
                  <span className="api-bubble-card__label">{META_SESSIONS_LINK_LABEL}</span>
                  {metaSessionsLink?.url && !editingMetaSessionsLink && (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-edit"
                        onClick={startEditMetaSessionsLink}
                        title="Edit link"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="api-bubble-card__open"
                        onClick={openMetaSessionsLink}
                        title="Open in browser"
                      >
                        Open
                      </button>
                    </div>
                  )}
                </div>

                {editingMetaSessionsLink || !metaSessionsLink?.url ? (
                  <div className="api-bubble-card__form">
                    <input
                      className="cred-form__input"
                      type="url"
                      placeholder="https://developers.facebook.com/..."
                      value={metaSessionsDraft}
                      onChange={(e) => setMetaSessionsDraft(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="api-bubble-card__form-actions">
                      {editingMetaSessionsLink && (
                        <button
                          type="button"
                          className="api-bubble-card__cancel"
                          onClick={cancelEditMetaSessionsLink}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={saveMetaSessionsLink}
                        disabled={savingMetaSessionsLink || !metaSessionsDraft.trim()}
                      >
                        {savingMetaSessionsLink ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="api-bubble-card__url" title={metaSessionsLink.url}>
                    {metaSessionsLink.url}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {(view === 'accounts' || view === 'employee') && (
          <>
            {view === 'employee' && accounts.length > 0 && (
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

          {accounts.length > 0 && (
            <div className="account-search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="text"
                placeholder="Search accounts…"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {accountSearch && (
                <button type="button" className="account-search__clear" onClick={() => setAccountSearch('')}>
                  ✕
                </button>
              )}
            </div>
          )}

          {accountsLoading && accounts.length === 0 ? (
            loadingBlock
          ) : accounts.length === 0 ? (
            <p className="empty-note">
              {view === 'employee'
                ? 'This employee has not added any accounts yet.'
                : 'No accounts yet. Add a username above to start tracking.'}
            </p>
          ) : filteredAccounts.length === 0 ? (
            <p className="empty-note">No accounts match “{accountSearch}”.</p>
          ) : (
            <div className="account-list">
              {filteredAccounts.map((account) => (
                <AccountCard
                  key={account.username}
                  account={account}
                  totalViews={viewsByUsername.get(account.username) ?? 0}
                  ownerTag={
                    isAdmin && account.owner && account.owner !== 'admin'
                      ? account.owner
                      : undefined
                  }
                  unableToRefresh={failedRefresh.has(account.username)}
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
          {accountsLoading && accounts.length === 0 ? (
            loadingBlock
          ) : selectedAccount ? (
            <>
              <div className="detail-header">
                <div>
                  {!(selectedAccount.igUserId && selectedAccount.igAccessToken) && (
                    <h2>@{selectedAccount.username}</h2>
                  )}
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
                  {!(selectedAccount.igUserId && selectedAccount.igAccessToken) && (
                    <button
                      type="button"
                      onClick={() => refreshAccount(selectedAccount.username)}
                      disabled={refreshing === selectedAccount.username}
                    >
                      {refreshing === selectedAccount.username ? 'Refreshing…' : 'Refresh now'}
                    </button>
                  )}
                </div>
              </div>

              {failedRefresh.has(selectedAccount.username) && !selectedAccount.banned && (
                <div className="banner banner--warn banner--dismissible">
                  <span>
                    ⚠️ Unable to refresh, account might be banned or suspended. Please check status
                    of account.
                  </span>
                  <button
                    type="button"
                    className="banner__close"
                    onClick={() => clearRefreshFailed(selectedAccount.username)}
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}

              {!(selectedAccount.igUserId && selectedAccount.igAccessToken) && (
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
                  <div className="metric-card">
                    <span>Submitted Date</span>
                    <strong>{formatDate(selectedAccount.addedAt)}</strong>
                  </div>
                </div>
              )}

              {!(selectedAccount.igUserId && selectedAccount.igAccessToken) &&
                (selectedAccount.fullName || selectedAccount.bio) && (
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

              {selectedAccount.igUserId && selectedAccount.igAccessToken ? (
                <AccountInsights
                  key={selectedAccount.username}
                  igUserId={selectedAccount.igUserId}
                  accessToken={selectedAccount.igAccessToken}
                />
              ) : (
                <div className="section-block">
                  <h3>Analytics</h3>
                  <p className="empty-note">
                    Add this account's IG User ID and API token in{' '}
                    <button type="button" className="link-btn" onClick={() => setShowCredentials(true)}>
                      Credentials
                    </button>{' '}
                    to see followers, reach, views, demographics, and per-post insights.
                  </p>
                </div>
              )}

              {!(selectedAccount.igUserId && selectedAccount.igAccessToken) && (
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
              )}
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
            <div className="modal__card modal__card--fit" onClick={(e) => e.stopPropagation()}>
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
              <div className="modal__scroll">
                <AccountCredentials account={selectedAccount} onSave={handleSaveCredentials} />
              </div>
            </div>
          </div>
        )}

        {scheduleReel && (
          <div className="modal" onClick={closeScheduleModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                saveSchedule();
              }}
            >
              <div className="modal__head">
                <h3>
                  {scheduleMode === 'post' ? 'Post' : 'Schedule'}{' '}
                  {contentTabSingular(scheduleReel.mediaType ?? 'reel')}
                </h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeScheduleModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="schedule-modal__body">
                {scheduleReel.mediaType !== 'story' && (
                  <textarea
                    className="bio-form__textarea"
                    placeholder="Write a caption…"
                    value={newContentCaption}
                    onChange={(e) => setNewContentCaption(e.target.value)}
                    rows={3}
                  />
                )}

                {scheduleReel.mediaType === 'story' && (
                  <p className="cred-field__hint">
                    Instagram Stories publish without a feed caption.
                  </p>
                )}

                {scheduleMode === 'schedule' && (
                  <label className="cred-field">
                    <span className="cred-field__label">
                      Schedule date &amp; time ({timezoneLabel})
                    </span>
                    <input
                      type="datetime-local"
                      className="cred-form__input"
                      value={newContentScheduledAt}
                      onChange={(e) => setNewContentScheduledAt(e.target.value)}
                    />
                  </label>
                )}

                <label className="cred-field">
                  <span className="cred-field__label">Instagram account to post on</span>
                  <select
                    className="cred-form__input"
                    value={newContentTarget}
                    onChange={(e) => setNewContentTarget(e.target.value)}
                  >
                    <option value="">
                      {postableAccounts.length === 0
                        ? 'No accounts with saved API credentials'
                        : 'Select an account…'}
                    </option>
                    {postableAccounts.map((a) => (
                      <option key={a.username} value={a.username}>
                        @{a.username}
                        {a.owner ? ` · ${a.owner}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="cred-field__hint">
                    Only Instagram accounts with a saved API token &amp; User ID can be posted to.
                    {!isAdmin ? ' You can only post to accounts you have added under Accounts.' : ''}
                    {' '}
                    You can post or schedule the same{' '}
                    {scheduleReel ? contentTabSingular(scheduleReel.mediaType ?? 'reel') : 'item'} to
                    multiple accounts, including ones it was already posted to.
                  </span>
                </label>

                <label className="cred-field">
                  <span className="cred-field__label">Proxy (optional)</span>
                  <select
                    className="cred-form__input"
                    value={newContentProxyId}
                    onChange={(e) => setNewContentProxyId(e.target.value)}
                  >
                    <option value="">
                      {availableProxies.length === 0 ? 'No proxies available' : 'No proxy'}
                    </option>
                    {availableProxies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {proxyOptionLabel(p)}
                      </option>
                    ))}
                  </select>
                  <span className="cred-field__hint">
                    Route this publish through a proxy from your Proxy library.
                  </span>
                </label>
              </div>

              {scheduleMode === 'post' && modalPublishProgress && (
                <PublishProgressBar stage={modalPublishProgress.stage} />
              )}

              <div className="schedule-modal__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={closeScheduleModal}
                  disabled={savingSchedule}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSchedule || Boolean(scheduleReel && isContentPublishing(scheduleReel))}
                >
                  {savingSchedule || (scheduleReel && isContentPublishing(scheduleReel))
                    ? scheduleMode === 'post'
                      ? 'Posting…'
                      : 'Saving…'
                    : scheduleMode === 'post'
                      ? 'Post'
                      : 'Schedule'}
                </button>
              </div>
            </form>
          </div>
        )}

        {assignBio && (
          <div className="modal" onClick={closeAssignBioModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void saveBioAssign();
              }}
            >
              <div className="modal__head">
                <h3>Assign bio</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAssignBioModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="cred-note">
                Select which employees will see this bio in their accounts.
              </p>

              <div className="schedule-modal__body">
                <AssignmentPicker
                  employees={employees}
                  selected={assignBioEmployees}
                  all={assignBioAll}
                  onToggle={toggleAssignBioEmployee}
                  onAllChange={setAssignBioAll}
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAssignBioModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBioAssign || (!assignBioAll && assignBioEmployees.size === 0)}
                >
                  {savingBioAssign ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        )}

        {assignReel && (
          <div className="modal" onClick={closeAssignModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                saveAssign();
              }}
            >
              <div className="modal__head">
                <h3>Assign {contentTabSingular(assignReel.mediaType ?? 'reel')}</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAssignModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="cred-note">
                Select which employees will see this{' '}
                {contentTabSingular(assignReel.mediaType ?? 'reel')} in
                their accounts.
              </p>

              <div className="schedule-modal__body">
                <AssignmentPicker
                  employees={employees}
                  selected={newContentEmployees}
                  all={newContentAll}
                  onToggle={toggleContentEmployee}
                  onAllChange={setNewContentAll}
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAssignModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAssign || (!newContentAll && newContentEmployees.size === 0)}
                >
                  {savingAssign ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        )}

        {historyReel && (
          <div className="modal" onClick={() => setHistoryReel(null)}>
            <div className="modal__card" onClick={(e) => e.stopPropagation()}>
              <div className="modal__head">
                <h3>Post history</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setHistoryReel(null)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {(historyReel.postHistory?.length ?? 0) === 0 ? (
                <p className="empty-note">
                  This {contentTabSingular(historyReel.mediaType ?? 'reel')} hasn’t been posted yet.
                </p>
              ) : (
                <ul className="post-history">
                  {[...(historyReel.postHistory ?? [])]
                    .sort((a, b) => b.postedAt - a.postedAt)
                    .map((entry, i) => (
                      <li key={`${entry.account}-${entry.postedAt}-${i}`} className="post-history__row">
                        <div className="post-history__main">
                          <span className="post-history__account">@{entry.account}</span>
                          <span className="post-history__date">
                            {formatDateTimeLocal(entry.postedAt)}
                          </span>
                        </div>
                        {entry.permalink && (
                          <a
                            className="post-history__link"
                            href={entry.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </a>
                        )}
                      </li>
                    ))}
                </ul>
              )}
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

        {editItem && (
          <div className="modal" onClick={() => setEditItem(null)}>
            <form
              className="modal__card modal__card--wide"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                saveEdit();
              }}
            >
              <div className="modal__head">
                <h3>
                  Edit{' '}
                  {editItem.kind === 'proxy'
                    ? 'proxy'
                    : editItem.kind === 'license'
                      ? 'license'
                      : editItem.kind === 'bio'
                        ? 'bio'
                        : editItem.kind === 'story'
                          ? 'story'
                          : 'CTA'}
                </h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={() => setEditItem(null)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="bio-form">
                {editItem.kind === 'proxy' ? (
                  <>
                    <label className="cred-field">
                      <span className="cred-field__label">Proxy link</span>
                      <input
                        className="cred-form__input"
                        value={editItem.text}
                        onChange={(e) => setEditItem({ ...editItem, text: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="cred-field">
                      <span className="cred-field__label">Rotating link</span>
                      <input
                        className="cred-form__input"
                        value={editItem.rotating}
                        onChange={(e) => setEditItem({ ...editItem, rotating: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label className="cred-field">
                      <span className="cred-field__label">Type</span>
                      <select
                        className="cred-form__input"
                        value={editItem.type}
                        onChange={(e) => setEditItem({ ...editItem, type: e.target.value })}
                      >
                        <option value="http">HTTP</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </label>
                  </>
                ) : editItem.kind === 'license' ? (
                  <label className="cred-field">
                    <span className="cred-field__label">License key</span>
                    <input
                      className="cred-form__input"
                      value={editItem.text}
                      onChange={(e) => setEditItem({ ...editItem, text: e.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ) : (
                  <>
                    <textarea
                      className="bio-form__textarea"
                      value={editItem.text}
                      onChange={(e) => setEditItem({ ...editItem, text: e.target.value })}
                      rows={4}
                    />
                  </>
                )}

                {editItem.kind !== 'bio' && (
                  <AssignmentPicker
                    employees={employees}
                    selected={editItem.employees}
                    all={editItem.allEmployees}
                    onToggle={toggleEditEmployee}
                    onAllChange={(all) => setEditItem({ ...editItem, allEmployees: all })}
                  />
                )}

                <button type="submit">Save changes</button>
              </div>
            </form>
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
      </div>
    </>
  );
}
