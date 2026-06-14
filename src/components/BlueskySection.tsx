import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Bio,
  BskyAccount,
  BskyPost,
  BskySavedAccount,
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
  addPost,
  addProfilePic,
  addProxy,
  addSavedAccount,
  deleteBanner,
  deleteBio,
  deleteBskyAccount,
  deleteCta,
  deleteEmployee,
  deletePost,
  deleteProfilePic,
  deleteProxy,
  deleteSavedAccount,
  getBanners,
  getBios,
  getBskyAccounts,
  getCtas,
  getEmployees,
  getPosts,
  getProfilePics,
  getProxies,
  getSavedAccounts,
} from '../lib/bsky/db';
import { runAccountJob, type JobResult } from '../lib/bsky/client';
import { AssignmentPicker } from './AssignmentPicker';
import { CopyButton } from './CopyButton';
import { CopyField } from './CopyField';
import { assignedEmployees } from '../lib/assignment';
import { parseProxyString } from '../lib/proxy';
import { formatCount, formatDate } from '../lib/format';

type View =
  | 'dashboard'
  | 'accounts'
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

const LS_FOLLOW_SETTINGS = 'drbossing_bsky_follow_settings';

interface FollowSettings {
  maxFollowers: number;
  delayMs: number;
  skipExisting: boolean;
}

function loadFollowSettings(): FollowSettings {
  try {
    const raw = localStorage.getItem(LS_FOLLOW_SETTINGS);
    if (raw) return { maxFollowers: 1000, delayMs: 1500, skipExisting: true, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { maxFollowers: 1000, delayMs: 1500, skipExisting: true };
}

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

  const [newAcctHandle, setNewAcctHandle] = useState('');
  const [newAcctEmail, setNewAcctEmail] = useState('');
  const [newAcctPassword, setNewAcctPassword] = useState('');
  const [newAcctNotes, setNewAcctNotes] = useState('');
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
  const [acctType, setAcctType] = useState<'followers' | 'following'>('followers');
  const [selectedSavedId, setSelectedSavedId] = useState('');

  const [followSettings, setFollowSettings] = useState<FollowSettings>(() => loadFollowSettings());
  const [running, setRunning] = useState(false);
  const [runState, setRunState] = useState<Record<string, RunState>>({});
  const cancelRef = useRef<Record<string, boolean>>({});

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
    const [bn, pp, bi, ct, po, px, ac, sa] = await Promise.all([
      getBanners(ownerFilter),
      getProfilePics(ownerFilter),
      getBios(ownerFilter),
      getCtas(ownerFilter),
      getPosts(ownerFilter),
      getProxies(ownerFilter),
      getBskyAccounts(ownerFilter),
      getSavedAccounts(ownerFilter),
    ]);
    setBanners(bn);
    setProfilePics(pp);
    setBios(bi);
    setCtas(ct);
    setPosts(po);
    setProxies(px);
    setAccounts(ac);
    setSavedAccounts(sa);
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
    if (!acctId.trim() || !acctPw.trim() || !acctTarget.trim() || !assignValid('acct')) return;
    await addBskyAccount({
      id: crypto.randomUUID(),
      identifier: acctId.trim(),
      password: acctPw.trim(),
      target: acctTarget.trim(),
      type: acctType,
      createdAt: Date.now(),
      ...assignPayload('acct'),
    });
    setAcctId('');
    setAcctPw('');
    setAcctTarget('');
    setAcctType('followers');
    setSelectedSavedId('');
    resetAssign('acct');
    await loadAll();
  }

  function pickSavedAccount(id: string) {
    setSelectedSavedId(id);
    const acct = savedAccounts.find((a) => a.id === id);
    if (acct) {
      setAcctId(acct.handle);
      if (acct.password) setAcctPw(acct.password);
    }
  }

  function updateFollowSettings(patch: Partial<FollowSettings>) {
    setFollowSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LS_FOLLOW_SETTINGS, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function runOne(account: BskyAccount) {
    cancelRef.current[account.id] = false;
    setRunState((p) => ({
      ...p,
      [account.id]: { state: 'auth', text: 'Starting…', done: 0, total: 0, result: null, live: '' },
    }));
    const res = await runAccountJob(
      {
        identifier: account.identifier,
        password: account.password,
        service: account.service,
        target: account.target,
        type: account.type,
        maxFollowers: followSettings.maxFollowers,
        delayMode: 'fixed',
        delayMs: followSettings.delayMs,
        skipExisting: followSettings.skipExisting,
      },
      {
        onStatus: (state, text) =>
          setRunState((p) => ({ ...p, [account.id]: { ...p[account.id], state, text } })),
        onProgress: (d) =>
          setRunState((p) => ({
            ...p,
            [account.id]: {
              ...p[account.id],
              done: d.done,
              total: d.total,
              result: { success: d.success, skipped: d.skipped, failed: d.failed, total: d.total, cancelled: d.cancelled },
              live: d.status === 'followed' ? `✓ followed @${d.label}` : p[account.id]?.live ?? '',
            },
          })),
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
    for (const a of accounts) cancelRef.current[a.id] = true;
  }

  async function handleDeleteAccount(id: string) {
    await deleteBskyAccount(id);
    await loadAll();
  }

  async function handleAddSavedAccount(e: FormEvent) {
    e.preventDefault();
    if (!newAcctHandle.trim()) return;
    const owner = session.role === 'employee' ? session.username : 'admin';
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

  const dashboardCards = [
    { label: 'Employees', value: employees.length, show: isAdmin },
    { label: 'Accounts', value: savedAccounts.length, show: true },
    { label: 'Follow Accounts', value: accounts.length, show: true },
    { label: 'Posts', value: posts.length, show: true },
    { label: 'Banners', value: banners.length, show: true },
    { label: 'Profile Pictures', value: profilePics.length, show: true },
    { label: 'Bios', value: bios.length, show: true },
    { label: 'CTAs', value: ctas.length, show: true },
    { label: 'Proxies', value: proxies.length, show: true },
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
                <p className="empty-note">
                  Manage your Bluesky banners, profile pictures, bios, posts, CTAs, proxies and run
                  mass-follow jobs from the menu on the left.
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
                    <h2>Follow settings</h2>
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
                  <div className="follow-settings">
                    <label className="cred-field">
                      <span className="cred-field__label">Max follows per account</span>
                      <input
                        type="number"
                        className="cred-form__input"
                        value={followSettings.maxFollowers}
                        min={1}
                        onChange={(e) => updateFollowSettings({ maxFollowers: Number(e.target.value) })}
                      />
                    </label>
                    <label className="cred-field">
                      <span className="cred-field__label">Delay between follows (ms)</span>
                      <input
                        type="number"
                        className="cred-form__input"
                        value={followSettings.delayMs}
                        min={0}
                        onChange={(e) => updateFollowSettings({ delayMs: Number(e.target.value) })}
                      />
                    </label>
                    <label className="follow-skip">
                      <input
                        type="checkbox"
                        checked={followSettings.skipExisting}
                        onChange={(e) => updateFollowSettings({ skipExisting: e.target.checked })}
                      />
                      Skip people already followed
                    </label>
                  </div>
                </section>

                {isAdmin && (
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
                      <input
                        className="cred-form__input"
                        placeholder="Target profile (handle or bsky.app/profile/…)"
                        value={acctTarget}
                        onChange={(e) => setAcctTarget(e.target.value)}
                        autoComplete="off"
                      />
                      <select
                        className="cred-form__input"
                        value={acctType}
                        onChange={(e) => setAcctType(e.target.value as 'followers' | 'following')}
                      >
                        <option value="followers">Follow target's followers</option>
                        <option value="following">Follow who target follows</option>
                      </select>
                      <AssignmentPicker
                        employees={employees}
                        selected={getAssign('acct').set}
                        all={getAssign('acct').all}
                        onToggle={(u) => toggleAssign('acct', u)}
                        onAllChange={(a) => setAssignAll('acct', a)}
                      />
                      <button
                        type="submit"
                        disabled={!acctId.trim() || !acctPw.trim() || !acctTarget.trim() || !assignValid('acct')}
                      >
                        Add account
                      </button>
                    </form>
                    )}
                  </section>
                )}

                <section className="panel">
                  <h2>{isAdmin ? `Accounts (${accounts.length})` : 'Your accounts'}</h2>
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
                              </div>
                              <div className="row-actions">
                                {isAdmin && <div className="bio-row__assign">{renderAssignTags(acct)}</div>}
                                {!running && (
                                  <button type="button" className="row-edit" title="Run this account" onClick={() => runOne(acct)}>
                                    ▶
                                  </button>
                                )}
                                {isAdmin && (
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
