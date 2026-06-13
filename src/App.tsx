import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddAccountForm } from './components/AddAccountForm';
import { AccountCard } from './components/AccountCard';
import { AccountCredentials } from './components/AccountCredentials';
import { AssignmentPicker } from './components/AssignmentPicker';
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
  deleteContent,
  removeAccount,
  saveFollowerSnapshot,
  saveReelSnapshots,
  updateAccount,
} from './lib/db';
import { parseProxyString } from './lib/proxy';
import { assignedEmployees } from './lib/assignment';
import { latestByReel } from './lib/dashboard';
import { cacheImage, imgKey } from './lib/media';
import { formatCount, formatDate, proxiedImage } from './lib/format';
import type {
  Bio,
  ContentReel,
  Cta,
  Employee,
  FollowerSnapshot,
  License,
  ParsedReel,
  Proxy,
  ReelHistory,
  ReelSnapshot,
  Session,
  StoryNote,
  TrackedAccount,
} from './types';

function toDateKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function shiftDateKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d.getTime());
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
  const [refreshAllProgress, setRefreshAllProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [failedRefresh, setFailedRefresh] = useState<Set<string>>(() => new Set());
  const [accountSearch, setAccountSearch] = useState('');
  const [view, setView] = useState<
    'dashboard' | 'accounts' | 'employee' | 'license' | 'proxy' | 'bio' | 'cta' | 'story' | 'content'
  >('dashboard');
  const [showCredentials, setShowCredentials] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesOpen, setEmployeesOpen] = useState(true);
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
  const [newBioEmployees, setNewBioEmployees] = useState<Set<string>>(() => new Set());
  const [newBioAll, setNewBioAll] = useState(false);
  const [ctas, setCtas] = useState<Cta[]>([]);
  const [newCtaText, setNewCtaText] = useState('');
  const [newCtaEmployees, setNewCtaEmployees] = useState<Set<string>>(() => new Set());
  const [newCtaAll, setNewCtaAll] = useState(false);
  const [stories, setStories] = useState<StoryNote[]>([]);
  const [newStoryText, setNewStoryText] = useState('');
  const [newStoryEmployees, setNewStoryEmployees] = useState<Set<string>>(() => new Set());
  const [newStoryAll, setNewStoryAll] = useState(false);
  const [content, setContent] = useState<ContentReel[]>([]);
  const [newContentFile, setNewContentFile] = useState<File | null>(null);
  const [newContentCaption, setNewContentCaption] = useState('');
  const [newContentEmployees, setNewContentEmployees] = useState<Set<string>>(() => new Set());
  const [newContentAll, setNewContentAll] = useState(false);
  const [newContentTarget, setNewContentTarget] = useState('');
  const [newContentScheduledAt, setNewContentScheduledAt] = useState('');
  const [uploadingContent, setUploadingContent] = useState(false);
  const contentFileRef = useRef<HTMLInputElement>(null);
  const [scheduleFilter, setScheduleFilter] = useState<string | null>(() => {
    const s = loadSession();
    return s?.role === 'employee' ? toDateKey(Date.now()) : null;
  });
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
        await loadLicenses();
        await loadProxies();
        await loadBios();
        await loadCtas();
        await loadStories();
        await loadContent();
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
  }, [
    session,
    loadDashboardData,
    loadLicenses,
    loadProxies,
    loadBios,
    loadCtas,
    loadStories,
    loadContent,
  ]);

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
    if (!newBioAll && newBioEmployees.size === 0) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    try {
      await addBio({
        id: crypto.randomUUID(),
        text: newBioText,
        employees: newBioAll ? [] : [...newBioEmployees],
        allEmployees: newBioAll,
        createdAt: Date.now(),
      });
      await loadBios();
      setNewBioText('');
      setNewBioEmployees(new Set());
      setNewBioAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bio.');
    }
  }

  function toggleBioEmployee(username: string) {
    setNewBioEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
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

  async function submitContent() {
    if (!newContentFile) {
      setError('Select a reel video to upload.');
      return;
    }
    if (!newContentAll && newContentEmployees.size === 0) {
      setError('Select at least one employee or choose all employees.');
      return;
    }
    setUploadingContent(true);
    try {
      await addContent(
        {
          id: crypto.randomUUID(),
          caption: newContentCaption,
          videoUrl: '',
          employees: newContentAll ? [] : [...newContentEmployees],
          allEmployees: newContentAll,
          targetAccount: newContentTarget || undefined,
          scheduledAt: newContentScheduledAt ? new Date(newContentScheduledAt).getTime() : undefined,
          createdAt: Date.now(),
        },
        newContentFile,
      );
      await loadContent();
      setNewContentFile(null);
      setNewContentCaption('');
      setNewContentEmployees(new Set());
      setNewContentAll(false);
      setNewContentTarget('');
      setNewContentScheduledAt('');
      if (contentFileRef.current) contentFileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload reel.');
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

  async function downloadReel(reel: ContentReel) {
    if (!reel.videoUrl) return;
    try {
      const res = await fetch(reel.videoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reel-${reel.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(reel.videoUrl, '_blank', 'noopener');
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
    if (!editItem.allEmployees && editItem.employees.size === 0) {
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
  }) {
    if (!selectedAccount) return;
    const updated: TrackedAccount = {
      ...selectedAccount,
      loginUsername: values.loginUsername || undefined,
      loginEmail: values.loginEmail || undefined,
      loginPhone: values.loginPhone || undefined,
      loginPassword: values.loginPassword || undefined,
      authSecret: values.authSecret || undefined,
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
    setError(null);
    setWarning(null);
    setRefreshAllProgress(null);
    setRefreshing(null);
    setFailedRefresh(new Set());
  }

  const topbarTitle =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'employee'
        ? `Employee · ${selectedEmployee ?? ''}`
        : view === 'license'
          ? 'Blaze License'
          : view === 'proxy'
            ? 'Proxy'
            : view === 'bio'
              ? 'Account Bio'
              : view === 'cta'
                ? 'CTA'
                : view === 'story'
                  ? 'Stories'
                  : view === 'content'
                    ? 'Content'
                    : 'Accounts';

  const showAddForm = view === 'accounts';

  const contentTargetAccounts = accounts.filter((a) =>
    newContentAll
      ? true
      : Boolean(a.owner) && newContentEmployees.has(a.owner as string),
  );

  const displayedContent = (() => {
    let list = content;
    if (isAdmin && contentEmployeeFilter) {
      list = list.filter(
        (reel) => reel.allEmployees || reel.employees.includes(contentEmployeeFilter),
      );
    }
    if (scheduleFilter) {
      list = list
        .filter((reel) => reel.scheduledAt && toDateKey(reel.scheduledAt) === scheduleFilter)
        .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
    }
    return list;
  })();

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
            className={view === 'story' ? 'nav-item nav-item--active' : 'nav-item'}
            onClick={() => {
              setSelectedEmployee(null);
              setView('story');
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" strokeDasharray="3 2.2" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
            Stories
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

        {view === 'dashboard' &&
          (accountsLoading ? (
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

                  <AssignmentPicker
                    employees={employees}
                    selected={newBioEmployees}
                    all={newBioAll}
                    onToggle={toggleBioEmployee}
                    onAllChange={setNewBioAll}
                  />

                  <button
                    type="submit"
                    disabled={!newBioText.trim() || (!newBioAll && newBioEmployees.size === 0)}
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

        {view === 'story' && (
          <>
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Add story</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('story') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('story')}
                    title={openAddForms.has('story') ? 'Hide' : 'Add story'}
                    aria-label={openAddForms.has('story') ? 'Hide' : 'Add story'}
                  >
                    {openAddForms.has('story') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('story') && (
                <form
                  className="bio-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitStory();
                  }}
                >
                  <textarea
                    className="bio-form__textarea"
                    placeholder="Write the story…"
                    value={newStoryText}
                    onChange={(e) => setNewStoryText(e.target.value)}
                    rows={4}
                  />

                  <AssignmentPicker
                    employees={employees}
                    selected={newStoryEmployees}
                    all={newStoryAll}
                    onToggle={toggleStoryEmployee}
                    onAllChange={setNewStoryAll}
                  />

                  <button
                    type="submit"
                    disabled={!newStoryText.trim() || (!newStoryAll && newStoryEmployees.size === 0)}
                  >
                    Add story
                  </button>
                </form>
                )}
              </section>
            )}

            <section className="panel">
              <h2>{isAdmin ? `Stories (${stories.length})` : 'Your stories'}</h2>
              {stories.length === 0 ? (
                <p className="empty-note">
                  {isAdmin
                    ? 'No stories yet. Write one above and assign it to employees.'
                    : 'No story assigned to you yet.'}
                </p>
              ) : (
                <div className="bio-list">
                  {stories.map((story) => (
                    <div key={story.id} className="bio-row">
                      <div className="bio-row__body">
                        <p className="bio-row__text">{story.text}</p>
                        {isAdmin && (
                          <div className="bio-row__assign">
                            {story.allEmployees ? (
                              <span className="owner-tag">All employees</span>
                            ) : (
                              story.employees.map((u) => (
                                <span key={u} className="owner-tag">
                                  {u}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      <div className="row-actions">
                        <CopyButton value={story.text} title="Copy story" />
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className="row-edit"
                              onClick={() => openEditStory(story)}
                              title="Edit story"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteStory(story.id)}
                              title="Delete story"
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
            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Upload reel</h2>
                  <button
                    type="button"
                    className={`panel-add-toggle ${openAddForms.has('content') ? 'panel-add-toggle--open' : ''}`}
                    onClick={() => toggleAddForm('content')}
                    title={openAddForms.has('content') ? 'Hide' : 'Upload reel'}
                    aria-label={openAddForms.has('content') ? 'Hide' : 'Upload reel'}
                  >
                    {openAddForms.has('content') ? 'Hide' : 'Add'}
                  </button>
                </div>
                {openAddForms.has('content') && (
                <form
                  className="bio-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitContent();
                  }}
                >
                  <label className="content-upload">
                    <input
                      ref={contentFileRef}
                      type="file"
                      accept="video/*"
                      onChange={(e) => setNewContentFile(e.target.files?.[0] ?? null)}
                    />
                    <span className="content-upload__hint">
                      {newContentFile ? newContentFile.name : 'Choose a reel video (MP4/WebM)'}
                    </span>
                  </label>

                  <textarea
                    className="bio-form__textarea"
                    placeholder="Write a caption…"
                    value={newContentCaption}
                    onChange={(e) => setNewContentCaption(e.target.value)}
                    rows={3}
                  />

                  <label className="cred-field">
                    <span className="cred-field__label">Schedule date &amp; time (optional)</span>
                    <input
                      type="datetime-local"
                      className="cred-form__input"
                      value={newContentScheduledAt}
                      onChange={(e) => setNewContentScheduledAt(e.target.value)}
                    />
                  </label>

                  <AssignmentPicker
                    employees={employees}
                    selected={newContentEmployees}
                    all={newContentAll}
                    onToggle={toggleContentEmployee}
                    onAllChange={setNewContentAll}
                  />

                  {(newContentAll || newContentEmployees.size > 0) && (
                    <label className="cred-field">
                      <span className="cred-field__label">
                        Instagram account to post on (optional)
                      </span>
                      <select
                        className="cred-form__input"
                        value={newContentTarget}
                        onChange={(e) => setNewContentTarget(e.target.value)}
                      >
                        <option value="">No specific account</option>
                        {contentTargetAccounts.map((a) => (
                          <option key={a.username} value={a.username}>
                            @{a.username}
                            {a.owner ? ` · ${a.owner}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={
                      uploadingContent ||
                      !newContentFile ||
                      (!newContentAll && newContentEmployees.size === 0)
                    }
                  >
                    {uploadingContent ? 'Uploading…' : 'Upload reel'}
                  </button>
                </form>
                )}
              </section>
            )}

            <section className="panel">
              <div className="panel-head">
                <h2>
                  {isAdmin ? `Reels (${displayedContent.length})` : 'Your reels'}
                  {scheduleFilter && (
                    <span className="content-filter__active"> · scheduled {scheduleFilter}</span>
                  )}
                </h2>
                <div className="content-filter">
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
                  <button
                    type="button"
                    className="content-filter__nav"
                    onClick={() =>
                      setScheduleFilter((prev) =>
                        shiftDateKey(prev ?? toDateKey(Date.now()), -1),
                      )
                    }
                    title="Previous day"
                  >
                    ‹
                  </button>
                  <input
                    type="date"
                    className="content-filter__date"
                    value={scheduleFilter ?? ''}
                    onChange={(e) => setScheduleFilter(e.target.value || null)}
                  />
                  <button
                    type="button"
                    className="content-filter__nav"
                    onClick={() =>
                      setScheduleFilter((prev) =>
                        shiftDateKey(prev ?? toDateKey(Date.now()), 1),
                      )
                    }
                    title="Next day"
                  >
                    ›
                  </button>
                  {scheduleFilter && (
                    <button
                      type="button"
                      className="content-filter__clear"
                      onClick={() => setScheduleFilter(null)}
                    >
                      All
                    </button>
                  )}
                </div>
              </div>
              {displayedContent.length === 0 ? (
                <p className="empty-note">
                  {scheduleFilter
                    ? 'No reels scheduled for this date.'
                    : isAdmin
                      ? 'No reels yet. Upload one above and assign it to employees.'
                      : 'No reel assigned to you yet.'}
                </p>
              ) : (
                <div className="content-grid">
                  {displayedContent.map((reel) => (
                    <div key={reel.id} className="content-tile">
                      <video
                        className="content-tile__video"
                        src={reel.videoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                      {reel.scheduledAt && (
                        <p className="content-tile__schedule">
                          🗓 {new Date(reel.scheduledAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                      {reel.targetAccount && (
                        <p className="content-tile__target">📲 Post on @{reel.targetAccount}</p>
                      )}
                      {reel.caption ? (
                        <p className="content-tile__caption">{reel.caption}</p>
                      ) : (
                        <p className="content-tile__caption content-tile__caption--empty">
                          No Caption
                        </p>
                      )}
                      <div className="content-tile__meta">
                        {isAdmin && (
                          <div className="content-tile__assign">
                            {reel.allEmployees ? (
                              <span className="owner-tag">All employees</span>
                            ) : (
                              reel.employees.map((u) => (
                                <span key={u} className="owner-tag">
                                  {u}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                        <div className="content-tile__actions">
                          <button
                            type="button"
                            className="content-tile__download"
                            onClick={() => downloadReel(reel)}
                            title="Download reel"
                          >
                            ↓ Download
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteContent(reel.id)}
                              title="Delete reel"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
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

          {!accountsLoading && accounts.length > 0 && (
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

          {accountsLoading ? (
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
                  <textarea
                    className="bio-form__textarea"
                    value={editItem.text}
                    onChange={(e) => setEditItem({ ...editItem, text: e.target.value })}
                    rows={4}
                  />
                )}

                <AssignmentPicker
                  employees={employees}
                  selected={editItem.employees}
                  all={editItem.allEmployees}
                  onToggle={toggleEditEmployee}
                  onAllChange={(all) => setEditItem({ ...editItem, allEmployees: all })}
                />

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
  );
}
