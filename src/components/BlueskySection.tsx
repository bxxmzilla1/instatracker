import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Bio,
  BskyAccount,
  BskyFollowEvent,
  BskyPost,
  BskySavedAccount,
  BskyTarget,
  Cta,
  Employee,
  ImageAsset,
  Proxy,
  Session,
} from '../types';
import {
  addBanner,
  addBio,
  addBskyAccount,
  addCta,
  addEmployee,
  addFollowEvent,
  addPost,
  addProfilePic,
  addProxy,
  addSavedAccount,
  addTarget,
  deleteBanner,
  deleteBio,
  deleteBskyAccount,
  deleteCta,
  deleteEmployee,
  deletePost,
  deleteProfilePic,
  deleteProxy,
  deleteSavedAccount,
  deleteTarget,
  getBanners,
  getBios,
  getBskyAccounts,
  getCtas,
  getEmployees,
  getFollowEvents,
  getPosts,
  getProfilePics,
  getProxies,
  getSavedAccounts,
  getTargets,
} from '../lib/bsky/db';
import { runAccountJob, type JobResult, type ProxyConfig } from '../lib/bsky/client';
import { AssignmentPicker } from './AssignmentPicker';
import { BskyFollowChart, type FollowBar } from './BskyFollowChart';
import { CopyButton } from './CopyButton';
import { CopyField } from './CopyField';
import { assignedEmployees } from '../lib/assignment';
import { parseProxyString } from '../lib/proxy';
import { formatCount, formatDate } from '../lib/format';

type View =
  | 'dashboard'
  | 'accounts'
  | 'targets'
  | 'banner'
  | 'profilepic'
  | 'bio'
  | 'post'
  | 'follow'
  | 'proxy'
  | 'cta'
  | 'employees'
  | 'employee';

interface Props {
  session: Session;
  isAdmin: boolean;
  canSwitch: boolean;
  onSwitchToInstagram: () => void;
  onLock: () => void;
}

interface RunState {
  state: string;
  text: string;
  done: number;
  total: number;
  result: JobResult | null;
  live: string;
}

// Default follow settings used when an account doesn't specify its own.
const DEFAULT_MAX_FOLLOWERS = 1000;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_DELAY_MIN = 800;
const DEFAULT_DELAY_MAX = 2500;

export function BlueskySection({ session, isAdmin, canSwitch, onSwitchToInstagram, onLock }: Props) {
  const [view, setView] = useState<View>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({});
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');

  const [banners, setBanners] = useState<ImageAsset[]>([]);
  const [profilePics, setProfilePics] = useState<ImageAsset[]>([]);
  const [bios, setBios] = useState<Bio[]>([]);
  const [ctas, setCtas] = useState<Cta[]>([]);
  const [posts, setPosts] = useState<BskyPost[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [accounts, setAccounts] = useState<BskyAccount[]>([]);
  const [savedAccounts, setSavedAccounts] = useState<BskySavedAccount[]>([]);
  const [targets, setTargets] = useState<BskyTarget[]>([]);
  const [followEvents, setFollowEvents] = useState<BskyFollowEvent[]>([]);
  const [chartMonthOffset, setChartMonthOffset] = useState(0);

  const [newTargetHandle, setNewTargetHandle] = useState('');
  const [newTargetNotes, setNewTargetNotes] = useState('');
  const [showAddTarget, setShowAddTarget] = useState(false);

  const [newAcctHandle, setNewAcctHandle] = useState('');
  const [newAcctEmail, setNewAcctEmail] = useState('');
  const [newAcctPassword, setNewAcctPassword] = useState('');
  const [newAcctNotes, setNewAcctNotes] = useState('');
  const [newAcctOwner, setNewAcctOwner] = useState('admin');
  const [showAddSavedAccount, setShowAddSavedAccount] = useState(false);

  // Generic add-form assignment state, scoped per form key.
  const [assign, setAssign] = useState<Record<string, { set: Set<string>; all: boolean }>>({});
  // Which add-forms are expanded (hidden behind an "Add" button by default).
  const [openForms, setOpenForms] = useState<Set<string>>(() => new Set());

  function toggleForm(key: string) {
    setOpenForms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const [bioText, setBioText] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [postText, setPostText] = useState('');
  const [postFile, setPostFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerCaption, setBannerCaption] = useState('');
  const [picFile, setPicFile] = useState<File | null>(null);
  const [picCaption, setPicCaption] = useState('');
  const [proxyRaw, setProxyRaw] = useState('');
  const [proxyType, setProxyType] = useState('http');
  const [uploading, setUploading] = useState(false);

  const [acctId, setAcctId] = useState('');
  const [acctPw, setAcctPw] = useState('');
  const [acctTarget, setAcctTarget] = useState('');
  const [acctType] = useState<'followers' | 'following'>('followers');
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [acctMode, setAcctMode] = useState<'select' | 'new'>('select');
  const [acctDelayMode, setAcctDelayMode] = useState<'fixed' | 'random'>('fixed');
  const [acctDelayMs, setAcctDelayMs] = useState(1500);
  const [acctDelayMin, setAcctDelayMin] = useState(800);
  const [acctDelayMax, setAcctDelayMax] = useState(2500);
  const [acctMax, setAcctMax] = useState(DEFAULT_MAX_FOLLOWERS);
  const [acctSkip, setAcctSkip] = useState(true);
  const [acctProxyId, setAcctProxyId] = useState('');

  const [running, setRunning] = useState(false);
  // Number of follow jobs currently in flight. Tracked separately from the
  // "Start all" batch flag so single-account runs keep flushing + show in the
  // global indicator, and so jobs survive navigating between sidebar sections.
  const [activeJobs, setActiveJobs] = useState(0);
  const [runState, setRunState] = useState<Record<string, RunState>>({});
  const cancelRef = useRef<Record<string, boolean>>({});
  // Buffers successful follows so they can be flushed to storage once per second
  // (keeps the dashboard "Follows" count + graph live without a write per follow).
  const followBufferRef = useRef<{ accountId: string }[]>([]);

  const ownerFilter = useMemo(() => {
    if (session.role === 'employee') return session.username;
    if (view === 'employee') return selectedEmployee ?? '__none__';
    return undefined;
  }, [session, view, selectedEmployee]);

  function getAssign(key: string) {
    return assign[key] ?? { set: new Set<string>(), all: false };
  }
  function toggleAssign(key: string, username: string) {
    setAssign((prev) => {
      const cur = prev[key] ?? { set: new Set<string>(), all: false };
      const next = new Set(cur.set);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return { ...prev, [key]: { ...cur, set: next } };
    });
  }
  function setAssignAll(key: string, all: boolean) {
    setAssign((prev) => {
      const cur = prev[key] ?? { set: new Set<string>(), all: false };
      return { ...prev, [key]: { ...cur, all } };
    });
  }
  function resetAssign(key: string) {
    setAssign((prev) => ({ ...prev, [key]: { set: new Set<string>(), all: false } }));
  }
  function assignPayload(key: string) {
    const a = getAssign(key);
    return { employees: a.all ? [] : [...a.set], allEmployees: a.all };
  }
  function assignValid(key: string) {
    const a = getAssign(key);
    return a.all || a.set.size > 0;
  }

  const loadAll = useCallback(async () => {
    const [bn, pp, bi, ct, po, px, ac, sa, tg, fe] = await Promise.all([
      getBanners(ownerFilter),
      getProfilePics(ownerFilter),
      getBios(ownerFilter),
      getCtas(ownerFilter),
      getPosts(ownerFilter),
      getProxies(ownerFilter),
      getBskyAccounts(ownerFilter),
      getSavedAccounts(ownerFilter),
      getTargets(ownerFilter),
      getFollowEvents(),
    ]);
    setBanners(bn);
    setProfilePics(pp);
    setBios(bi);
    setCtas(ct);
    setPosts(po);
    setProxies(px);
    setAccounts(ac);
    setSavedAccounts(sa);
    setTargets(tg);
    setFollowEvents(fe);
  }, [ownerFilter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        if (isAdmin) {
          const emps = await getEmployees();
          if (!active) return;
          setEmployees(emps);
        }
        await loadAll();
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load Bluesky data');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, loadAll]);

  // Per-employee counts for the selection grid (accounts assigned to each).
  useEffect(() => {
    if (!isAdmin || employees.length === 0) return;
    (async () => {
      const all = await getBskyAccounts();
      const counts: Record<string, number> = {};
      for (const a of all) {
        if (a.allEmployees) {
          for (const e of employees) counts[e.username] = (counts[e.username] ?? 0) + 1;
        } else {
          for (const u of a.employees) counts[u] = (counts[u] ?? 0) + 1;
        }
      }
      setEmployeeCounts(counts);
    })();
  }, [isAdmin, employees]);

  // Drain buffered follows into persisted events (one row per account per tick).
  const flushFollowBuffer = useCallback(async () => {
    const buf = followBufferRef.current;
    if (buf.length === 0) return;
    followBufferRef.current = [];
    const counts = new Map<string, number>();
    for (const b of buf) counts.set(b.accountId, (counts.get(b.accountId) ?? 0) + 1);
    const now = Date.now();
    const events: BskyFollowEvent[] = [];
    for (const [accountId, count] of counts) {
      events.push({ id: crypto.randomUUID(), accountId, count, capturedAt: now });
    }
    setFollowEvents((prev) => [...prev, ...events]);
    for (const ev of events) {
      try {
        await addFollowEvent(ev);
      } catch {
        // keep the in-memory tally even if the write fails
      }
    }
  }, []);

  // While any job is in flight, persist follows every second so totals + graph
  // stay live — regardless of which sidebar section is currently shown.
  useEffect(() => {
    if (activeJobs === 0) return;
    const id = window.setInterval(() => {
      void flushFollowBuffer();
    }, 1000);
    return () => {
      window.clearInterval(id);
      void flushFollowBuffer();
    };
  }, [activeJobs, flushFollowBuffer]);

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
      setView('employees');
    }
  }

  async function submitBio(e: FormEvent) {
    e.preventDefault();
    if (!bioText.trim() || !assignValid('bio')) return;
    await addBio({ id: crypto.randomUUID(), text: bioText, createdAt: Date.now(), ...assignPayload('bio') });
    setBioText('');
    resetAssign('bio');
    await loadAll();
  }

  async function submitCta(e: FormEvent) {
    e.preventDefault();
    if (!ctaText.trim() || !assignValid('cta')) return;
    await addCta({ id: crypto.randomUUID(), text: ctaText, createdAt: Date.now(), ...assignPayload('cta') });
    setCtaText('');
    resetAssign('cta');
    await loadAll();
  }

  async function submitPost(e: FormEvent) {
    e.preventDefault();
    if ((!postText.trim() && !postFile) || !assignValid('post')) return;
    setUploading(true);
    try {
      await addPost(
        { id: crypto.randomUUID(), text: postText, createdAt: Date.now(), ...assignPayload('post') },
        postFile ?? undefined,
      );
      setPostText('');
      setPostFile(null);
      resetAssign('post');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add post.');
    } finally {
      setUploading(false);
    }
  }

  async function submitBanner(e: FormEvent) {
    e.preventDefault();
    if (!bannerFile || !assignValid('banner')) return;
    setUploading(true);
    try {
      await addBanner(
        { id: crypto.randomUUID(), url: '', caption: bannerCaption, createdAt: Date.now(), ...assignPayload('banner') },
        bannerFile,
      );
      setBannerFile(null);
      setBannerCaption('');
      resetAssign('banner');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add banner.');
    } finally {
      setUploading(false);
    }
  }

  async function submitPic(e: FormEvent) {
    e.preventDefault();
    if (!picFile || !assignValid('pic')) return;
    setUploading(true);
    try {
      await addProfilePic(
        { id: crypto.randomUUID(), url: '', caption: picCaption, createdAt: Date.now(), ...assignPayload('pic') },
        picFile,
      );
      setPicFile(null);
      setPicCaption('');
      resetAssign('pic');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add profile picture.');
    } finally {
      setUploading(false);
    }
  }

  async function submitProxy(e: FormEvent) {
    e.preventDefault();
    if (!proxyRaw.trim() || !assignValid('proxy')) return;
    const parsed = parseProxyString(proxyRaw);
    if (!parsed) {
      setError('Could not parse that proxy. Use host:port:user:pass or user:pass@host:port.');
      return;
    }
    await addProxy({
      id: crypto.randomUUID(),
      raw: proxyRaw,
      type: proxyType,
      host: parsed.host,
      port: parsed.port,
      username: parsed.user,
      password: parsed.pass,
      rotatingLink: '',
      createdAt: Date.now(),
      ...assignPayload('proxy'),
    });
    setProxyRaw('');
    setProxyType('http');
    resetAssign('proxy');
    await loadAll();
  }

  async function submitAccount(e: FormEvent) {
    e.preventDefault();
    if (!acctTarget.trim()) return;
    if (isAdmin && !assignValid('acct')) return;
    if (acctMode === 'select' && !selectedSavedId) return;
    if (acctMode === 'new' && (!acctId.trim() || !acctPw.trim())) return;
    // Employees own the accounts they add (assigned only to themselves);
    // admins choose the assignment via the picker.
    const ownership = isAdmin
      ? assignPayload('acct')
      : { employees: [session.username], allEmployees: false };
    await addBskyAccount({
      id: crypto.randomUUID(),
      identifier: acctId.trim(),
      password: acctPw.trim(),
      target: acctTarget.trim(),
      type: acctType,
      proxyId: acctProxyId || undefined,
      maxFollowers: acctMax,
      skipExisting: acctSkip,
      delayMode: acctDelayMode,
      delayMs: acctDelayMs,
      delayMin: acctDelayMin,
      delayMax: acctDelayMax,
      createdAt: Date.now(),
      ...ownership,
    });
    setAcctId('');
    setAcctPw('');
    setAcctTarget('');
    setSelectedSavedId('');
    setAcctMode('select');
    setAcctMax(DEFAULT_MAX_FOLLOWERS);
    setAcctSkip(true);
    setAcctProxyId('');
    setAcctDelayMode('fixed');
    setAcctDelayMs(1500);
    setAcctDelayMin(800);
    setAcctDelayMax(2500);
    resetAssign('acct');
    await loadAll();
  }

  function pickSavedAccount(id: string) {
    setSelectedSavedId(id);
    const acct = savedAccounts.find((a) => a.id === id);
    if (acct) {
      setAcctId(acct.handle);
      setAcctPw(acct.password ?? '');
    } else {
      setAcctId('');
      setAcctPw('');
    }
  }

  function changeAcctMode(mode: 'select' | 'new') {
    setAcctMode(mode);
    setSelectedSavedId('');
    setAcctId('');
    setAcctPw('');
  }

  function proxyLabel(p: Proxy) {
    if (p.host && p.port) return `${p.type || 'http'} · ${p.host}:${p.port}`;
    return p.raw || p.rotatingLink || p.id;
  }

  function proxyConfigFor(id?: string): ProxyConfig | undefined {
    if (!id) return undefined;
    const p = proxies.find((x) => x.id === id);
    if (!p) return undefined;
    if (p.host && p.port) {
      return {
        type: p.type || 'http',
        host: p.host,
        port: p.port,
        user: p.username || undefined,
        pass: p.password || undefined,
      };
    }
    const parsed = parseProxyString(p.raw || '');
    if (parsed) {
      return {
        type: parsed.type,
        host: parsed.host,
        port: parsed.port,
        user: parsed.user || undefined,
        pass: parsed.pass || undefined,
      };
    }
    return undefined;
  }

  async function runOne(account: BskyAccount) {
    cancelRef.current[account.id] = false;
    setActiveJobs((n) => n + 1);
    setRunState((p) => ({
      ...p,
      [account.id]: { state: 'auth', text: 'Starting…', done: 0, total: 0, result: null, live: '' },
    }));
    try {
      const res = await runAccountJob(
        {
          identifier: account.identifier,
          password: account.password,
          service: account.service,
          target: account.target,
          type: account.type,
          proxy: proxyConfigFor(account.proxyId),
          maxFollowers: account.maxFollowers ?? DEFAULT_MAX_FOLLOWERS,
          delayMode: account.delayMode ?? 'fixed',
          delayMs: account.delayMs ?? DEFAULT_DELAY_MS,
          delayMin: account.delayMin ?? DEFAULT_DELAY_MIN,
          delayMax: account.delayMax ?? DEFAULT_DELAY_MAX,
          skipExisting: account.skipExisting ?? true,
        },
        {
          onStatus: (state, text) =>
            setRunState((p) => ({ ...p, [account.id]: { ...p[account.id], state, text } })),
          onProgress: (d) => {
            if (d.status === 'followed') followBufferRef.current.push({ accountId: account.id });
            setRunState((p) => ({
              ...p,
              [account.id]: {
                ...p[account.id],
                done: d.done,
                total: d.total,
                result: { success: d.success, skipped: d.skipped, failed: d.failed, total: d.total, cancelled: d.cancelled },
                live: d.status === 'followed' ? `✓ followed @${d.label}` : p[account.id]?.live ?? '',
              },
            }));
          },
          shouldCancel: () => cancelRef.current[account.id],
        },
      );
      setRunState((p) => ({
        ...p,
        [account.id]: {
          ...p[account.id],
          state: res.ok ? (res.result.cancelled ? 'error' : 'done') : 'error',
          text: res.ok ? (res.result.cancelled ? 'Stopped' : 'Done') : res.error ?? 'Error',
          result: res.result,
        },
      }));
    } finally {
      setActiveJobs((n) => Math.max(0, n - 1));
    }
  }

  async function startAll() {
    if (running) return;
    const jobs = accounts.filter((a) => a.identifier && a.password && a.target);
    if (jobs.length === 0) {
      setError('Add at least one account with a handle, app password, and target profile.');
      return;
    }
    setError(null);
    setRunning(true);
    await Promise.all(jobs.map(runOne));
    setRunning(false);
  }

  function stopAll() {
    for (const id of Object.keys(runState)) cancelRef.current[id] = true;
    for (const a of accounts) cancelRef.current[a.id] = true;
  }

  async function handleDeleteAccount(id: string) {
    await deleteBskyAccount(id);
    await loadAll();
  }

  async function handleAddSavedAccount(e: FormEvent) {
    e.preventDefault();
    if (!newAcctHandle.trim()) return;
    const owner = session.role === 'employee' ? session.username : newAcctOwner;
    try {
      await addSavedAccount({
        id: crypto.randomUUID(),
        handle: newAcctHandle.trim().replace(/^@/, ''),
        email: newAcctEmail.trim() || undefined,
        password: newAcctPassword.trim() || undefined,
        notes: newAcctNotes.trim() || undefined,
        owner,
        createdAt: Date.now(),
      });
      setNewAcctHandle('');
      setNewAcctEmail('');
      setNewAcctPassword('');
      setNewAcctNotes('');
      setNewAcctOwner('admin');
      setShowAddSavedAccount(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save account.');
    }
  }

  async function handleDeleteSavedAccount(id: string) {
    await deleteSavedAccount(id);
    await loadAll();
  }

  async function toggleSavedAccountBanned(acct: BskySavedAccount) {
    await addSavedAccount({ ...acct, banned: !acct.banned });
    await loadAll();
  }

  async function submitTarget(e: FormEvent) {
    e.preventDefault();
    if (!newTargetHandle.trim()) return;
    if (isAdmin && !assignValid('target')) return;
    const ownership = isAdmin
      ? assignPayload('target')
      : { employees: [session.username], allEmployees: false };
    try {
      await addTarget({
        id: crypto.randomUUID(),
        handle: newTargetHandle.trim().replace(/^@/, ''),
        notes: newTargetNotes.trim() || undefined,
        createdAt: Date.now(),
        ...ownership,
      });
      setNewTargetHandle('');
      setNewTargetNotes('');
      resetAssign('target');
      setShowAddTarget(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save target profile.');
    }
  }

  async function handleDeleteTarget(id: string) {
    await deleteTarget(id);
    await loadAll();
  }

  const navItems: { id: View; label: string; icon: ReactNode }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      ),
    },
    {
      id: 'accounts',
      label: 'Accounts',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c0-3 2.7-5 5.5-5s5.5 2 5.5 5" />
          <path d="M16 5.2a3 3 0 0 1 0 5.6" />
          <path d="M18 14c2.2.4 3.8 2.2 3.8 4.6" />
        </svg>
      ),
    },
    {
      id: 'follow',
      label: 'Follow',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c0-3 2.7-5 5.5-5s5.5 2 5.5 5" />
          <path d="M19 8v6M16 11h6" />
        </svg>
      ),
    },
    {
      id: 'targets',
      label: 'Target Profiles',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      id: 'banner',
      label: 'Banner',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="m3 14 5-4 4 3 3-2 6 4" />
        </svg>
      ),
    },
    {
      id: 'profilepic',
      label: 'Profile Picture',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="9" r="3.5" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        </svg>
      ),
    },
    {
      id: 'bio',
      label: 'Account Bio',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />
        </svg>
      ),
    },
    {
      id: 'post',
      label: 'Post',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      ),
    },
    {
      id: 'proxy',
      label: 'Proxy',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      ),
    },
    {
      id: 'cta',
      label: 'CTA',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 11l18-7-7 18-2.5-7.5z" />
        </svg>
      ),
    },
  ];

  const topbarTitle =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'accounts'
      ? 'Accounts'
      : view === 'targets'
      ? 'Target Profiles'
      : view === 'banner'
        ? 'Banner'
        : view === 'profilepic'
          ? 'Profile Picture'
          : view === 'bio'
            ? 'Account Bio'
            : view === 'post'
              ? 'Post'
              : view === 'follow'
                ? 'Follow'
                : view === 'proxy'
                  ? 'Proxy'
                  : view === 'cta'
                    ? 'CTA'
                    : view === 'employee'
                      ? `Employee · ${selectedEmployee ?? ''}`
                      : 'Employees';

  function renderAssignTags(item: { allEmployees: boolean; employees: string[] }) {
    if (!isAdmin) return null;
    return item.allEmployees ? (
      <span className="owner-tag">All employees</span>
    ) : (
      item.employees.map((u) => (
        <span key={u} className="owner-tag">
          {u}
        </span>
      ))
    );
  }

  const imageSection = (
    title: string,
    items: ImageAsset[],
    file: File | null,
    setFile: (f: File | null) => void,
    caption: string,
    setCaption: (c: string) => void,
    submit: (e: FormEvent) => void,
    onDelete: (id: string) => Promise<void>,
    key: string,
  ) => (
    <>
      {isAdmin && (
        <section className="panel">
          <div className="panel-head">
            <h2>Add {title.toLowerCase()}</h2>
            <button
              type="button"
              className={`panel-add-toggle ${openForms.has(key) ? 'panel-add-toggle--open' : ''}`}
              onClick={() => toggleForm(key)}
            >
              {openForms.has(key) ? 'Hide' : 'Add'}
            </button>
          </div>
          {openForms.has(key) && (
            <form className="bio-form" onSubmit={submit}>
              <label className="content-upload">
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="content-upload__hint">{file ? file.name : `Choose a ${title.toLowerCase()} image`}</span>
              </label>
              <input
                className="cred-form__input"
                placeholder="Caption (optional)"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <AssignmentPicker
                employees={employees}
                selected={getAssign(key).set}
                all={getAssign(key).all}
                onToggle={(u) => toggleAssign(key, u)}
                onAllChange={(a) => setAssignAll(key, a)}
              />
              <button type="submit" disabled={uploading || !file || !assignValid(key)}>
                {uploading ? 'Uploading…' : `Add ${title.toLowerCase()}`}
              </button>
            </form>
          )}
        </section>
      )}
      <section className="panel">
        <h2>{isAdmin ? `${title}s (${items.length})` : `Your ${title.toLowerCase()}s`}</h2>
        {items.length === 0 ? (
          <p className="empty-note">Nothing here yet.</p>
        ) : (
          <div className="content-grid">
            {items.map((item) => (
              <div key={item.id} className="content-tile">
                <img className="bsky-image" src={item.url} alt={item.caption ?? ''} loading="lazy" />
                {item.caption && <p className="content-tile__caption">{item.caption}</p>}
                <div className="content-tile__meta">
                  <div className="content-tile__assign">{renderAssignTags(item)}</div>
                  <div className="content-tile__actions">
                    <a className="content-tile__download" href={item.url} download target="_blank" rel="noreferrer">
                      ↓ Download
                    </a>
                    {isAdmin && (
                      <button
                        type="button"
                        className="license-row__delete"
                        onClick={() => onDelete(item.id)}
                        title="Delete"
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
  );

  const textSection = (
    title: string,
    items: (Bio | Cta)[],
    text: string,
    setText: (t: string) => void,
    submit: (e: FormEvent) => void,
    onDelete: (id: string) => Promise<void>,
    key: string,
  ) => (
    <>
      {isAdmin && (
        <section className="panel">
          <div className="panel-head">
            <h2>Add {title.toLowerCase()}</h2>
            <button
              type="button"
              className={`panel-add-toggle ${openForms.has(key) ? 'panel-add-toggle--open' : ''}`}
              onClick={() => toggleForm(key)}
            >
              {openForms.has(key) ? 'Hide' : 'Add'}
            </button>
          </div>
          {openForms.has(key) && (
            <form className="bio-form" onSubmit={submit}>
              <textarea
                className="bio-form__textarea"
                placeholder={`Write the ${title.toLowerCase()}…`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
              />
              <AssignmentPicker
                employees={employees}
                selected={getAssign(key).set}
                all={getAssign(key).all}
                onToggle={(u) => toggleAssign(key, u)}
                onAllChange={(a) => setAssignAll(key, a)}
              />
              <button type="submit" disabled={!text.trim() || !assignValid(key)}>
                Add {title.toLowerCase()}
              </button>
            </form>
          )}
        </section>
      )}
      <section className="panel">
        <h2>{isAdmin ? `${title}s (${items.length})` : `Your ${title.toLowerCase()}s`}</h2>
        {items.length === 0 ? (
          <p className="empty-note">Nothing here yet.</p>
        ) : (
          <div className="bio-list">
            {items.map((item) => (
              <div key={item.id} className="bio-row">
                <div className="bio-row__body">
                  <p className="bio-row__text">{item.text}</p>
                  {isAdmin && <div className="bio-row__assign">{renderAssignTags(item)}</div>}
                </div>
                <div className="row-actions">
                  <CopyButton value={item.text} title={`Copy ${title.toLowerCase()}`} />
                  {isAdmin && (
                    <button type="button" className="license-row__delete" onClick={() => onDelete(item.id)} title="Delete">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );

  const bannedCount = savedAccounts.filter((a) => a.banned).length;

  // Only count follows belonging to accounts the current user can see.
  const visibleAccountIds = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);
  const visibleFollowEvents = useMemo(
    () => followEvents.filter((e) => visibleAccountIds.has(e.accountId)),
    [followEvents, visibleAccountIds],
  );
  const totalFollows = useMemo(
    () => visibleFollowEvents.reduce((sum, e) => sum + e.count, 0),
    [visibleFollowEvents],
  );

  // An account counts as "new" when it was created on today's calendar day,
  // and "old" once it rolls over to a previous day.
  const followChartMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + chartMonthOffset);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [chartMonthOffset]);

  const followBars: FollowBar[] = useMemo(() => {
    const { year, month } = followChartMonth;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newAcctIds = new Set(
      accounts.filter((a) => a.createdAt >= todayStart.getTime()).map((a) => a.id),
    );
    const now = new Date();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const isCurrent = year === now.getFullYear() && month === now.getMonth();
    const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());
    const lastDay = isCurrent ? now.getDate() : isPast ? daysInMonth : 0;
    const bars: FollowBar[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const start = new Date(year, month, day, 0, 0, 0, 0).getTime();
      const end = new Date(year, month, day, 23, 59, 59, 999).getTime();
      let newValue = 0;
      let oldValue = 0;
      if (day <= lastDay) {
        for (const ev of visibleFollowEvents) {
          if (ev.capturedAt >= start && ev.capturedAt <= end) {
            if (newAcctIds.has(ev.accountId)) newValue += ev.count;
            else oldValue += ev.count;
          }
        }
      }
      bars.push({
        day,
        newValue,
        oldValue,
        isFuture: day > lastDay,
        isToday: isCurrent && day === lastDay,
      });
    }
    return bars;
  }, [accounts, visibleFollowEvents, followChartMonth]);

  const monthFollowTotal = followBars.reduce((s, b) => s + b.newValue + b.oldValue, 0);
  const followMonthLabel = new Date(followChartMonth.year, followChartMonth.month, 1).toLocaleString(
    undefined,
    { month: 'long', year: 'numeric' },
  );

  const dashboardCards = [
    { label: 'Employees', value: employees.length, show: isAdmin },
    { label: 'Accounts', value: savedAccounts.length, show: true },
    { label: 'Target Profiles', value: targets.length, show: true },
    { label: 'Follows', value: totalFollows, show: true },
    { label: 'Banned Accounts', value: bannedCount, show: true },
  ].filter((c) => c.show);

  return (
    <div className="app-shell app-shell--bluesky">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="none">
              <path d="M12 10.8C10.7 8.3 7.4 4 4.6 4 3.1 4 2 5.2 2 7.4c0 2.4 1.5 6.6 2.4 7.8.9 1.2 2.6 1.6 4.1 1.2-2.7.5-3.4 2.5-1.9 4.4 2.9 3.7 4.2-1.4 4.5-2.7l.9-2.9.9 2.9c.3 1.3 1.6 6.4 4.5 2.7 1.5-1.9.8-3.9-1.9-4.4 1.5.4 3.2 0 4.1-1.2.9-1.2 2.4-5.4 2.4-7.8C22 5.2 20.9 4 19.4 4c-2.8 0-6.1 4.3-7.4 6.8Z" />
            </svg>
          </span>
          <span className="sidebar__name">Dr. Bossing</span>
        </div>

        {canSwitch && (
          <div className="platform-switch">
            <button type="button" className="platform-switch__btn" onClick={onSwitchToInstagram}>
              Instagram
            </button>
            <button type="button" className="platform-switch__btn platform-switch__btn--active">
              Bluesky
            </button>
          </div>
        )}

        <nav className="sidebar__nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'nav-item nav-item--active' : 'nav-item'}
              onClick={() => {
                setSelectedEmployee(null);
                setView(item.id);
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          {isAdmin && (
            <button
              type="button"
              className={view === 'employees' || view === 'employee' ? 'nav-item nav-item--active' : 'nav-item'}
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

        <button type="button" className="nav-item sidebar__lock" onClick={onLock}>
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
            {activeJobs > 0 && (
              <div className="follow-running" role="status">
                <span className="follow-running__pulse" aria-hidden />
                <span className="follow-running__text">
                  Following · {activeJobs} {activeJobs === 1 ? 'account' : 'accounts'} ·{' '}
                  {formatCount(
                    Object.values(runState).reduce((s, r) => s + (r.result?.success ?? 0), 0),
                  )}{' '}
                  followed
                </span>
                {view !== 'follow' && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setView('follow');
                    }}
                  >
                    View
                  </button>
                )}
                <button type="button" className="btn btn--danger" onClick={stopAll}>
                  Stop
                </button>
              </div>
            )}
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
                <button type="button" className="btn btn--ghost" onClick={() => handleDeleteEmployee(selectedEmployee)}>
                  Remove employee
                </button>
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="banner banner--error banner--dismissible">
            <span>{error}</span>
            <button type="button" className="banner__close" onClick={() => setError(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {loading ? (
          <section className="panel">
            <div className="loading-block">
              <span className="spinner" aria-hidden />
              <span>Loading…</span>
            </div>
          </section>
        ) : (
          <>
            {view === 'dashboard' && (
              <section className="panel dashboard">
                <div className="dashboard__stats">
                  {dashboardCards.map((c) => (
                    <div key={c.label} className="stat-card">
                      <span className="stat-card__label">{c.label}</span>
                      <strong className="stat-card__value">{formatCount(c.value)}</strong>
                    </div>
                  ))}
                </div>

                <div className="dashboard__chart">
                  <div className="dashboard__chart-head">
                    <div className="bsky-legend">
                      <span className="bsky-legend__item">
                        <span className="bsky-legend__dot bsky-legend__dot--new" />
                        New accounts
                      </span>
                      <span className="bsky-legend__item">
                        <span className="bsky-legend__dot bsky-legend__dot--old" />
                        Old accounts
                      </span>
                    </div>
                    <div className="month-nav">
                      <button
                        type="button"
                        className="month-nav__btn"
                        onClick={() => setChartMonthOffset((o) => o - 1)}
                        aria-label="Previous month"
                      >
                        ‹
                      </button>
                      <span className="month-nav__label">{followMonthLabel}</span>
                      <button
                        type="button"
                        className="month-nav__btn"
                        onClick={() => setChartMonthOffset((o) => o + 1)}
                        disabled={chartMonthOffset >= 0}
                        aria-label="Next month"
                      >
                        ›
                      </button>
                    </div>
                  </div>

                  <div className="trend-chart__summary">
                    <strong>{formatCount(monthFollowTotal)}</strong>
                    <span className="delta">new follows this month{running ? ' · live' : ''}</span>
                  </div>

                  <BskyFollowChart bars={followBars} />
                </div>

                <p className="empty-note">
                  Live follow totals update every second while jobs run. Bars split each day's new
                  follows by accounts added today (new) versus earlier (old).
                </p>
              </section>
            )}

            {view === 'accounts' && (
              <section className="panel">
                <div className="panel-head">
                  <h2>
                    {isAdmin ? `Accounts (${savedAccounts.length})` : `Your accounts (${savedAccounts.length})`}
                  </h2>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAddSavedAccount((v) => !v)}
                  >
                    {showAddSavedAccount ? 'Cancel' : '+ Save account'}
                  </button>
                </div>

                {showAddSavedAccount && (
                  <form className="bio-form" onSubmit={handleAddSavedAccount}>
                    <input
                      className="cred-form__input"
                      placeholder="Handle (e.g. name.bsky.social)"
                      value={newAcctHandle}
                      onChange={(e) => setNewAcctHandle(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <input
                      className="cred-form__input"
                      placeholder="Email (optional)"
                      value={newAcctEmail}
                      onChange={(e) => setNewAcctEmail(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <input
                      className="cred-form__input"
                      type="text"
                      placeholder="Password / app password (optional)"
                      value={newAcctPassword}
                      onChange={(e) => setNewAcctPassword(e.target.value)}
                      autoComplete="off"
                    />
                    <textarea
                      className="bio-form__textarea"
                      placeholder="Notes (optional)"
                      value={newAcctNotes}
                      onChange={(e) => setNewAcctNotes(e.target.value)}
                      rows={2}
                    />
                    {isAdmin && (
                      <label className="cred-field">
                        <span className="cred-field__label">Assign to</span>
                        <select
                          className="cred-form__input"
                          value={newAcctOwner}
                          onChange={(e) => setNewAcctOwner(e.target.value)}
                        >
                          <option value="admin">Admin only</option>
                          {employees.map((emp) => (
                            <option key={emp.username} value={emp.username}>
                              {emp.username}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button type="submit" disabled={!newAcctHandle.trim()}>
                      Save account
                    </button>
                  </form>
                )}

                {savedAccounts.length === 0 ? (
                  <p className="empty-note">
                    No accounts saved yet. Use “Save account” to add one
                    {isAdmin ? '. Accounts your employees add will also appear here.' : '.'}
                  </p>
                ) : (
                  <div className="proxy-list">
                    {savedAccounts.map((acct) => (
                      <div key={acct.id} className="proxy-row">
                        <div className="proxy-row__body">
                          <div className="proxy-row__top">
                            <strong>@{acct.handle}</strong>
                            {acct.banned && <span className="owner-tag owner-tag--banned">Banned</span>}
                            {isAdmin && acct.owner && acct.owner !== 'admin' && (
                              <span className="owner-tag">Added by {acct.owner}</span>
                            )}
                          </div>
                          <div className="proxy-row__fields">
                            <CopyField label="Handle" value={acct.handle} />
                            {acct.email && <CopyField label="Email" value={acct.email} />}
                            {acct.password && <CopyField label="Password" value={acct.password} />}
                          </div>
                          {acct.notes && <p className="bio-row__text">{acct.notes}</p>}
                        </div>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="row-edit"
                            onClick={() => toggleSavedAccountBanned(acct)}
                            title={acct.banned ? 'Mark as active' : 'Mark as banned'}
                          >
                            {acct.banned ? '↩' : '⊘'}
                          </button>
                          <button
                            type="button"
                            className="license-row__delete"
                            onClick={() => handleDeleteSavedAccount(acct.id)}
                            title="Delete account"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {view === 'targets' && (
              <section className="panel">
                <div className="panel-head">
                  <h2>
                    {isAdmin ? `Target Profiles (${targets.length})` : `Your target profiles (${targets.length})`}
                  </h2>
                  <button type="button" className="btn" onClick={() => setShowAddTarget((v) => !v)}>
                    {showAddTarget ? 'Cancel' : '+ Add target'}
                  </button>
                </div>

                {showAddTarget && (
                  <form className="bio-form" onSubmit={submitTarget}>
                    <input
                      className="cred-form__input"
                      placeholder="Target profile (handle or bsky.app/profile/…)"
                      value={newTargetHandle}
                      onChange={(e) => setNewTargetHandle(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <textarea
                      className="bio-form__textarea"
                      placeholder="Notes (optional)"
                      value={newTargetNotes}
                      onChange={(e) => setNewTargetNotes(e.target.value)}
                      rows={2}
                    />
                    {isAdmin && (
                      <AssignmentPicker
                        employees={employees}
                        selected={getAssign('target').set}
                        all={getAssign('target').all}
                        onToggle={(u) => toggleAssign('target', u)}
                        onAllChange={(a) => setAssignAll('target', a)}
                        adminOption
                      />
                    )}
                    <button
                      type="submit"
                      disabled={!newTargetHandle.trim() || (isAdmin && !assignValid('target'))}
                    >
                      Add target profile
                    </button>
                  </form>
                )}

                {targets.length === 0 ? (
                  <p className="empty-note">
                    No target profiles saved yet. Use “Add target” to save one
                    {isAdmin ? ' and assign it to employees.' : '.'}
                  </p>
                ) : (
                  <div className="proxy-list">
                    {targets.map((t) => (
                      <div key={t.id} className="proxy-row">
                        <div className="proxy-row__body">
                          <div className="proxy-row__top">
                            <strong>@{t.handle}</strong>
                            {isAdmin && <div className="bio-row__assign">{renderAssignTags(t)}</div>}
                          </div>
                          <div className="proxy-row__fields">
                            <CopyField label="Target" value={t.handle} />
                          </div>
                          {t.notes && <p className="bio-row__text">{t.notes}</p>}
                        </div>
                        <div className="row-actions">
                          {(isAdmin || t.employees.includes(session.username)) && (
                            <button
                              type="button"
                              className="license-row__delete"
                              onClick={() => handleDeleteTarget(t.id)}
                              title="Delete target profile"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {view === 'banner' &&
              imageSection('Banner', banners, bannerFile, setBannerFile, bannerCaption, setBannerCaption, submitBanner, deleteBanner, 'banner')}

            {view === 'profilepic' &&
              imageSection('Profile Picture', profilePics, picFile, setPicFile, picCaption, setPicCaption, submitPic, deleteProfilePic, 'pic')}

            {view === 'bio' && textSection('Bio', bios, bioText, setBioText, submitBio, deleteBio, 'bio')}

            {view === 'cta' && textSection('CTA', ctas, ctaText, setCtaText, submitCta, deleteCta, 'cta')}

            {view === 'post' && (
              <>
                {isAdmin && (
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Add post</h2>
                      <button
                        type="button"
                        className={`panel-add-toggle ${openForms.has('post') ? 'panel-add-toggle--open' : ''}`}
                        onClick={() => toggleForm('post')}
                      >
                        {openForms.has('post') ? 'Hide' : 'Add'}
                      </button>
                    </div>
                    {openForms.has('post') && (
                      <form className="bio-form" onSubmit={submitPost}>
                        <textarea
                          className="bio-form__textarea"
                          placeholder="Write the post text…"
                          value={postText}
                          onChange={(e) => setPostText(e.target.value)}
                          rows={4}
                        />
                        <label className="content-upload">
                          <input type="file" accept="image/*" onChange={(e) => setPostFile(e.target.files?.[0] ?? null)} />
                          <span className="content-upload__hint">{postFile ? postFile.name : 'Attach an image (optional)'}</span>
                        </label>
                        <AssignmentPicker
                          employees={employees}
                          selected={getAssign('post').set}
                          all={getAssign('post').all}
                          onToggle={(u) => toggleAssign('post', u)}
                          onAllChange={(a) => setAssignAll('post', a)}
                        />
                        <button type="submit" disabled={uploading || (!postText.trim() && !postFile) || !assignValid('post')}>
                          {uploading ? 'Uploading…' : 'Add post'}
                        </button>
                      </form>
                    )}
                  </section>
                )}
                <section className="panel">
                  <h2>{isAdmin ? `Posts (${posts.length})` : 'Your posts'}</h2>
                  {posts.length === 0 ? (
                    <p className="empty-note">Nothing here yet.</p>
                  ) : (
                    <div className="bio-list">
                      {posts.map((post) => (
                        <div key={post.id} className="bio-row">
                          <div className="bio-row__body">
                            {post.imageUrl && <img className="bsky-image bsky-image--post" src={post.imageUrl} alt="" loading="lazy" />}
                            <p className="bio-row__text">{post.text}</p>
                            {isAdmin && <div className="bio-row__assign">{renderAssignTags(post)}</div>}
                          </div>
                          <div className="row-actions">
                            {post.text && <CopyButton value={post.text} title="Copy post" />}
                            {isAdmin && (
                              <button type="button" className="license-row__delete" onClick={() => deletePost(post.id).then(loadAll)} title="Delete">
                                ✕
                              </button>
                            )}
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
                        className={`panel-add-toggle ${openForms.has('proxy') ? 'panel-add-toggle--open' : ''}`}
                        onClick={() => toggleForm('proxy')}
                      >
                        {openForms.has('proxy') ? 'Hide' : 'Add'}
                      </button>
                    </div>
                    {openForms.has('proxy') && (
                      <form className="license-form" onSubmit={submitProxy}>
                        <input
                          className="cred-form__input"
                          placeholder="host:port:user:pass or user:pass@host:port"
                          value={proxyRaw}
                          onChange={(e) => setProxyRaw(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <select
                          className="cred-form__input license-form__select proxy-type-select"
                          value={proxyType}
                          onChange={(e) => setProxyType(e.target.value)}
                        >
                          <option value="http">HTTP</option>
                          <option value="socks5">SOCKS5</option>
                        </select>
                        <AssignmentPicker
                          employees={employees}
                          selected={getAssign('proxy').set}
                          all={getAssign('proxy').all}
                          onToggle={(u) => toggleAssign('proxy', u)}
                          onAllChange={(a) => setAssignAll('proxy', a)}
                        />
                        <button type="submit" disabled={!proxyRaw.trim() || !assignValid('proxy')}>
                          Add proxy
                        </button>
                      </form>
                    )}
                  </section>
                )}
                <section className="panel">
                  <h2>{isAdmin ? `Proxies (${proxies.length})` : 'Your proxies'}</h2>
                  {proxies.length === 0 ? (
                    <p className="empty-note">Nothing here yet.</p>
                  ) : (
                    <div className="proxy-list">
                      {proxies.map((proxy) => (
                        <div key={proxy.id} className="proxy-row">
                          <div className="proxy-row__body">
                            <div className="proxy-row__top">
                              <span className={`proxy-type-tag proxy-type-tag--${proxy.type}`}>{proxy.type.toUpperCase()}</span>
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
                            <div className="proxy-row__fields">
                              <CopyField label="IP" value={proxy.host} />
                              <CopyField label="Port" value={proxy.port} />
                              <CopyField label="Username" value={proxy.username} />
                              <CopyField label="Password" value={proxy.password} />
                            </div>
                          </div>
                          {isAdmin && (
                            <div className="row-actions">
                              <button type="button" className="license-row__delete" onClick={() => deleteProxy(proxy.id).then(loadAll)} title="Delete proxy">
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

            {view === 'follow' && (
              <>
                <section className="panel">
                    <div className="panel-head">
                      <h2>Add account</h2>
                      <button
                        type="button"
                        className={`panel-add-toggle ${openForms.has('acct') ? 'panel-add-toggle--open' : ''}`}
                        onClick={() => toggleForm('acct')}
                      >
                        {openForms.has('acct') ? 'Hide' : 'Add'}
                      </button>
                    </div>
                    {openForms.has('acct') && (
                    <form className="bio-form" onSubmit={submitAccount}>
                      <div className="platform-switch">
                        <button
                          type="button"
                          className={
                            acctMode === 'select'
                              ? 'platform-switch__btn platform-switch__btn--active'
                              : 'platform-switch__btn'
                          }
                          onClick={() => changeAcctMode('select')}
                        >
                          Select account
                        </button>
                        <button
                          type="button"
                          className={
                            acctMode === 'new'
                              ? 'platform-switch__btn platform-switch__btn--active'
                              : 'platform-switch__btn'
                          }
                          onClick={() => changeAcctMode('new')}
                        >
                          Add new account
                        </button>
                      </div>

                      {acctMode === 'select' ? (
                        <label className="cred-field">
                          <span className="cred-field__label">Select account</span>
                          <select
                            className="cred-form__input"
                            value={selectedSavedId}
                            onChange={(e) => pickSavedAccount(e.target.value)}
                          >
                            <option value="">Select account</option>
                            {savedAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                @{a.handle}
                                {a.owner && a.owner !== 'admin' ? ` · ${a.owner}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <>
                          <input
                            className="cred-form__input"
                            placeholder="Handle or email (e.g. name.bsky.social)"
                            value={acctId}
                            onChange={(e) => setAcctId(e.target.value)}
                            autoComplete="off"
                          />
                          <input
                            className="cred-form__input"
                            type="text"
                            placeholder="App password (xxxx-xxxx-xxxx-xxxx)"
                            value={acctPw}
                            onChange={(e) => setAcctPw(e.target.value)}
                            autoComplete="off"
                          />
                        </>
                      )}

                      {targets.length > 0 && (
                        <label className="cred-field">
                          <span className="cred-field__label">Saved target profile</span>
                          <select
                            className="cred-form__input"
                            value={targets.some((t) => t.handle === acctTarget) ? acctTarget : ''}
                            onChange={(e) => setAcctTarget(e.target.value)}
                          >
                            <option value="">Choose a saved target…</option>
                            {targets.map((t) => (
                              <option key={t.id} value={t.handle}>
                                @{t.handle}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <input
                        className="cred-form__input"
                        placeholder="Target profile (handle or bsky.app/profile/…)"
                        value={acctTarget}
                        onChange={(e) => setAcctTarget(e.target.value)}
                        autoComplete="off"
                      />

                      <label className="cred-field">
                        <span className="cred-field__label">Max follows for this account</span>
                        <input
                          type="number"
                          className="cred-form__input"
                          value={acctMax}
                          min={1}
                          onChange={(e) => setAcctMax(Number(e.target.value))}
                        />
                      </label>

                      <label className="cred-field">
                        <span className="cred-field__label">Follow interval for this account</span>
                        <select
                          className="cred-form__input"
                          value={acctDelayMode}
                          onChange={(e) => setAcctDelayMode(e.target.value as 'fixed' | 'random')}
                        >
                          <option value="fixed">Fixed delay</option>
                          <option value="random">Random range</option>
                        </select>
                      </label>
                      {acctDelayMode === 'fixed' ? (
                        <label className="cred-field">
                          <span className="cred-field__label">Delay between follows (ms)</span>
                          <input
                            type="number"
                            className="cred-form__input"
                            value={acctDelayMs}
                            min={0}
                            onChange={(e) => setAcctDelayMs(Number(e.target.value))}
                          />
                        </label>
                      ) : (
                        <div className="follow-range">
                          <label className="cred-field">
                            <span className="cred-field__label">Min delay (ms)</span>
                            <input
                              type="number"
                              className="cred-form__input"
                              value={acctDelayMin}
                              min={0}
                              onChange={(e) => setAcctDelayMin(Number(e.target.value))}
                            />
                          </label>
                          <label className="cred-field">
                            <span className="cred-field__label">Max delay (ms)</span>
                            <input
                              type="number"
                              className="cred-form__input"
                              value={acctDelayMax}
                              min={0}
                              onChange={(e) => setAcctDelayMax(Number(e.target.value))}
                            />
                          </label>
                        </div>
                      )}

                      <label className="cred-field">
                        <span className="cred-field__label">Proxy for this account</span>
                        <select
                          className="cred-form__input"
                          value={acctProxyId}
                          onChange={(e) => setAcctProxyId(e.target.value)}
                        >
                          <option value="">No proxy (direct)</option>
                          {proxies.map((p) => (
                            <option key={p.id} value={p.id}>
                              {proxyLabel(p)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="follow-skip">
                        <input
                          type="checkbox"
                          checked={acctSkip}
                          onChange={(e) => setAcctSkip(e.target.checked)}
                        />
                        Skip people already followed
                      </label>

                      {isAdmin && (
                        <AssignmentPicker
                          employees={employees}
                          selected={getAssign('acct').set}
                          all={getAssign('acct').all}
                          onToggle={(u) => toggleAssign('acct', u)}
                          onAllChange={(a) => setAssignAll('acct', a)}
                          adminOption
                        />
                      )}
                      <button
                        type="submit"
                        disabled={
                          !acctTarget.trim() ||
                          (isAdmin && !assignValid('acct')) ||
                          (acctMode === 'select' ? !selectedSavedId : !acctId.trim() || !acctPw.trim())
                        }
                      >
                        Add account
                      </button>
                    </form>
                    )}
                  </section>

                <section className="panel">
                  <div className="panel-head">
                    <h2>{isAdmin ? `Accounts (${accounts.length})` : 'Your accounts'}</h2>
                    <div className="topbar__actions">
                      {running ? (
                        <button type="button" className="btn btn--danger" onClick={stopAll}>
                          Stop all
                        </button>
                      ) : (
                        <button type="button" className="btn" onClick={startAll} disabled={accounts.length === 0}>
                          Start all
                        </button>
                      )}
                    </div>
                  </div>
                  {accounts.length === 0 ? (
                    <p className="empty-note">No accounts configured yet.</p>
                  ) : (
                    <div className="follow-list">
                      {accounts.map((acct) => {
                        const rs = runState[acct.id];
                        const pct = rs && rs.total ? Math.round((rs.done / rs.total) * 100) : 0;
                        return (
                          <div key={acct.id} className={`follow-card follow-card--${rs?.state ?? 'idle'}`}>
                            <div className="follow-card__head">
                              <div>
                                <strong>@{acct.identifier}</strong>
                                <span className="follow-card__target">
                                  {acct.type === 'followers' ? 'followers of' : 'following of'} @{acct.target}
                                </span>
                                <span className="follow-card__target">
                                  ⏱{' '}
                                  {acct.delayMode === 'random'
                                    ? `${acct.delayMin ?? DEFAULT_DELAY_MIN}–${acct.delayMax ?? DEFAULT_DELAY_MAX}ms`
                                    : `${acct.delayMs ?? DEFAULT_DELAY_MS}ms`}
                                </span>
                                {acct.proxyId && (
                                  <span className="follow-card__target">
                                    🌐 {proxies.find((p) => p.id === acct.proxyId) ? proxyLabel(proxies.find((p) => p.id === acct.proxyId)!) : 'proxy'}
                                  </span>
                                )}
                              </div>
                              <div className="row-actions">
                                {isAdmin && <div className="bio-row__assign">{renderAssignTags(acct)}</div>}
                                {!running && (
                                  <button type="button" className="row-edit" title="Run this account" onClick={() => runOne(acct)}>
                                    ▶
                                  </button>
                                )}
                                {(isAdmin || acct.employees.includes(session.username)) && (
                                  <button type="button" className="license-row__delete" onClick={() => handleDeleteAccount(acct.id)} title="Delete">
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                            {rs && (
                              <>
                                <div className="refresh-progress__track follow-card__track">
                                  <div className="refresh-progress__fill" style={{ width: `${pct}%` }} />
                                </div>
                                <div className="follow-card__status">
                                  <span className={`follow-dot follow-dot--${rs.state}`} />
                                  <span>{rs.text}</span>
                                  {rs.result && (
                                    <span className="follow-card__counts">
                                      {rs.result.success} followed · {rs.result.skipped} skipped · {rs.result.failed} failed
                                      {rs.result.total ? ` / ${rs.result.total}` : ''}
                                    </span>
                                  )}
                                </div>
                                {rs.live && <p className="follow-card__live">{rs.live}</p>}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}

            {view === 'employees' && isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Employees ({employees.length})</h2>
                  <button type="button" className="btn" onClick={() => setShowAddEmployee(true)}>
                    + Add new employee
                  </button>
                </div>
                {employees.length === 0 ? (
                  <p className="empty-note">No employees yet. Add one to assign Bluesky tasks.</p>
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
                            {employeeCounts[employee.username] ?? 0} follow account
                            {(employeeCounts[employee.username] ?? 0) === 1 ? '' : 's'}
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

            {view === 'employee' && selectedEmployee && (
              <section className="panel dashboard">
                <div className="dashboard__stats">
                  <div className="stat-card">
                    <span className="stat-card__label">Accounts</span>
                    <strong className="stat-card__value">{formatCount(savedAccounts.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Follow Accounts</span>
                    <strong className="stat-card__value">{formatCount(accounts.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Posts</span>
                    <strong className="stat-card__value">{formatCount(posts.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Banners</span>
                    <strong className="stat-card__value">{formatCount(banners.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Profile Pictures</span>
                    <strong className="stat-card__value">{formatCount(profilePics.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Bios</span>
                    <strong className="stat-card__value">{formatCount(bios.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">CTAs</span>
                    <strong className="stat-card__value">{formatCount(ctas.length)}</strong>
                  </div>
                  <div className="stat-card">
                    <span className="stat-card__label">Proxies</span>
                    <strong className="stat-card__value">{formatCount(proxies.length)}</strong>
                  </div>
                </div>
                <p className="empty-note">
                  Everything assigned to <strong>{selectedEmployee}</strong> is shown above. Use the menu
                  sections to manage individual assignments.
                </p>
              </section>
            )}
          </>
        )}

        {showAddEmployee && (
          <div className="modal" onClick={() => setShowAddEmployee(false)}>
            <form className="modal__card" onClick={(e) => e.stopPropagation()} onSubmit={handleAddEmployee}>
              <div className="modal__head">
                <h3>Add new employee</h3>
                <button type="button" className="modal__close" onClick={() => setShowAddEmployee(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <p className="cred-note">Create a Bluesky sub-account separate from Instagram.</p>
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
