import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Bio,
  BskyAccount,
  BskyFollowEvent,
  BskyPost,
  BskyPostPublish,
  BskyRun,
  BskySavedAccount,
  BskySlaveAccount,
  BskyTarget,
  BskyWarmupRun,
  Employee,
  ImageAsset,
  Proxy,
  Session,
} from '../types';
import {
  addBanner,
  addBio,
  addBskyAccount,
  addEmployee,
  addFollowEvents,
  addPost,
  addProfilePic,
  addProxy,
  addSavedAccount,
  addSlaveAccount,
  addTarget,
  deleteBanner,
  deleteBio,
  deleteBskyAccount,
  deleteEmployee,
  deletePost,
  deleteProfilePic,
  deleteProxy,
  deleteSavedAccount,
  deleteSlaveAccount,
  deleteTarget,
  getBanners,
  getBios,
  getBskyAccounts,
  getEmployees,
  getFollowEvents,
  getPosts,
  getProfilePics,
  getProxies,
  getRuns,
  getSavedAccounts,
  getSlaveAccounts,
  getTargets,
  getWarmupRuns,
  upsertRun,
  upsertWarmupRun,
  deleteWarmupRun,
  updateBanner,
  updateBio,
  updatePost,
  updateProfilePic,
} from '../lib/bsky/db';
import {
  pushProfileBio,
  pushProfileImageFromFile,
  pushProfileImageFromUrl,
  publishBskyMediaPost,
  getBskyPostEngagement,
  verifyBskyLogin,
  deleteBskyPost,
  likeBskyPost,
  unlikeBskyPost,
  repostBskyPost,
  unrepostBskyPost,
  runAccountJob,
  type BskyCredentials,
  type JobResult,
  type ProxyConfig,
} from '../lib/bsky/client';
import { runAccountWarmup, WARMUP_STEP_COUNT } from '../lib/bsky/warmup';
import { AssignmentPicker } from './AssignmentPicker';
import { ProxyPicker } from './ProxyPicker';
import { SavedAccountMultiPicker } from './SavedAccountMultiPicker';
import { SavedAccountPicker } from './SavedAccountPicker';
import { WarmupAccountMultiPicker } from './WarmupAccountMultiPicker';
import { SquareImageCropModal } from './SquareImageCropModal';
import { BskyFollowChart, type FollowBar } from './BskyFollowChart';
import { CopyButton } from './CopyButton';
import { CopyField } from './CopyField';
import { HoverLoopVideo } from './HoverLoopVideo';
import { assignedEmployees, matchesEmployee } from '../lib/assignment';
import { isSupabaseConfigured } from '../lib/supabase';
import { parseProxyString } from '../lib/proxy';
import { formatCount, formatDate } from '../lib/format';

type ProfilePushKind = 'bio' | 'banner' | 'avatar' | 'post';

interface ProfilePushProgressState {
  pushKey: string;
  done: number;
  total: number;
  currentHandle?: string;
  kind: ProfilePushKind;
}

function profilePushProgressPercent(done: number, total: number, inFlight: boolean): number {
  if (total <= 0) return inFlight ? 12 : 0;
  const slice = inFlight ? 0.35 : 0;
  return Math.min(100, Math.round(((done + slice) / total) * 100));
}

function profilePushProgressLabel(progress: ProfilePushProgressState): string {
  const noun =
    progress.kind === 'bio'
      ? 'bio'
      : progress.kind === 'banner'
        ? 'banner'
        : progress.kind === 'post'
          ? 'post'
          : 'profile picture';
  const verb = progress.kind === 'post' ? 'Posting' : 'Updating';
  const handle = progress.currentHandle
    ? progress.currentHandle.includes('·')
      ? ` ${progress.currentHandle}`
      : ` @${progress.currentHandle}`
    : '';
  if (progress.total <= 1) {
    return `${verb} ${noun}…${handle}`;
  }
  const step = Math.min(progress.done + (progress.currentHandle ? 1 : 0), progress.total);
  return `${verb} ${noun} ${step} of ${progress.total}…${handle}`;
}

function ProfilePushProgressBar({ progress }: { progress: ProfilePushProgressState }) {
  const inFlight = Boolean(progress.currentHandle);
  return (
    <div className="publish-progress">
      <div className="publish-progress__track">
        <div
          className="publish-progress__fill"
          style={{
            width: `${profilePushProgressPercent(progress.done, progress.total, inFlight)}%`,
          }}
        />
      </div>
      <span className="publish-progress__label">{profilePushProgressLabel(progress)}</span>
    </div>
  );
}

type View =
  | 'dashboard'
  | 'accounts'
  | 'slaves'
  | 'warmups'
  | 'targets'
  | 'banner'
  | 'profilepic'
  | 'bio'
  | 'post'
  | 'follow'
  | 'proxy'
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

// A shared run is considered live only if its heartbeat is newer than this.
const RUN_STALE_MS = 15000;
// Finished warm-ups are cleared from the UI/DB shortly after completion.
const WARMUP_DONE_FLASH_MS = 8000;
/** Max accounts warming up at the same time, in selection order. */
const WARMUP_CONCURRENCY = 5;

// Local day key (YYYY-M-D) used to keep one cumulative follow-event row per
// account per day, so the events table stays small instead of growing forever.
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// Default follow settings used when an account doesn't specify its own.
const DEFAULT_MAX_FOLLOWERS = 1000;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_DELAY_MIN = 800;
const DEFAULT_DELAY_MAX = 2500;

export function BlueskySection({ session, isAdmin, canSwitch, onSwitchToInstagram, onLock }: Props) {
  const [view, setView] = useState<View>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeCounts, setEmployeeCounts] = useState<Record<string, number>>({});
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmpUsername, setNewEmpUsername] = useState('');
  const [newEmpPassword, setNewEmpPassword] = useState('');

  const [banners, setBanners] = useState<ImageAsset[]>([]);
  const [profilePics, setProfilePics] = useState<ImageAsset[]>([]);
  const [bios, setBios] = useState<Bio[]>([]);
  const [posts, setPosts] = useState<BskyPost[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [accounts, setAccounts] = useState<BskyAccount[]>([]);
  const [savedAccounts, setSavedAccounts] = useState<BskySavedAccount[]>([]);
  const [slaveAccounts, setSlaveAccounts] = useState<BskySlaveAccount[]>([]);
  const [showAddSlave, setShowAddSlave] = useState(false);
  const [newSlaveHandle, setNewSlaveHandle] = useState('');
  const [newSlavePassword, setNewSlavePassword] = useState('');
  const [newSlaveProxyId, setNewSlaveProxyId] = useState('');
  const [savingSlave, setSavingSlave] = useState(false);
  // Multi-select for bulk-deleting slave accounts.
  const [selectedSlaveIds, setSelectedSlaveIds] = useState<Set<string>>(() => new Set());
  const [deletingSlaves, setDeletingSlaves] = useState(false);
  // Warm-up tabs, selection, and per-account bubble progress.
  type WarmupTab = 'follow' | 'slave';
  type WarmupCardStatus = 'ready' | 'waiting' | 'running' | 'done' | 'error';
  type WarmupCardState = {
    status: WarmupCardStatus;
    step: number;
    totalSteps: number;
    label: string;
    error?: string;
  };
  const [warmupTab, setWarmupTab] = useState<WarmupTab>('follow');
  const [warmupFollowEmployee, setWarmupFollowEmployee] = useState('');
  const [selectedFollowWarmupIds, setSelectedFollowWarmupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectAllFollowWarmups, setSelectAllFollowWarmups] = useState(false);
  const [selectedSlaveWarmupIds, setSelectedSlaveWarmupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectAllSlaveWarmups, setSelectAllSlaveWarmups] = useState(false);
  const [warmupRunning, setWarmupRunning] = useState(false);
  const [warmupCardProgress, setWarmupCardProgress] = useState<Record<string, WarmupCardState>>(
    {},
  );
  const [deletingWarmupKey, setDeletingWarmupKey] = useState<string | null>(null);
  const warmupWriteTimesRef = useRef<Record<string, number>>({});
  const warmupExecutorKeysRef = useRef<Set<string>>(new Set());
  const warmupCardProgressRef = useRef<Record<string, WarmupCardState>>({});
  const warmupClientIdRef = useRef(`client-${crypto.randomUUID()}`);
  const warmupResumeLockRef = useRef(false);
  const warmupCancelRef = useRef<Record<string, boolean>>({});
  const warmupStopRequestedRef = useRef(false);
  // Per-engagement-card input for how many slave accounts to like / repost with.
  const [engagementInputs, setEngagementInputs] = useState<
    Record<string, { like: string; repost: string }>
  >({});
  // Label of the in-flight mass action, keyed by post id (null when idle).
  const [massActionStatus, setMassActionStatus] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<BskyTarget[]>([]);
  const [followEvents, setFollowEvents] = useState<BskyFollowEvent[]>([]);
  const [chartMonthOffset, setChartMonthOffset] = useState(0);
  const [selectedFollowDay, setSelectedFollowDay] = useState<number | null>(null);

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
  const [postMediaTab, setPostMediaTab] = useState<'image' | 'video' | 'engagement'>('image');
  const [postPublishAccountIds, setPostPublishAccountIds] = useState<Set<string>>(() => new Set());
  const [postPublishAllAccounts, setPostPublishAllAccounts] = useState(false);
  const [postPublishProxyId, setPostPublishProxyId] = useState('');
  const [postPublishingId, setPostPublishingId] = useState<string | null>(null);
  const [postPublishProgress, setPostPublishProgress] = useState<ProfilePushProgressState | null>(null);
  const [refreshingPostStats, setRefreshingPostStats] = useState<string | null>(null);
  const [deletingProfilePost, setDeletingProfilePost] = useState<string | null>(null);
  const [postCaptionModal, setPostCaptionModal] = useState<{ post: BskyPost } | null>(null);
  const [postCaptionText, setPostCaptionText] = useState('');
  const [postHashtagsText, setPostHashtagsText] = useState('');
  const [assignPost, setAssignPost] = useState<BskyPost | null>(null);
  const [assignPostEmployees, setAssignPostEmployees] = useState<Set<string>>(() => new Set());
  const [assignPostAll, setAssignPostAll] = useState(false);
  const [savingPostAssign, setSavingPostAssign] = useState(false);
  const postFileInputRef = useRef<HTMLInputElement>(null);
  const bannerAddInputRef = useRef<HTMLInputElement>(null);
  const picAddInputRef = useRef<HTMLInputElement>(null);
  const [profilePicCropFile, setProfilePicCropFile] = useState<File | null>(null);
  const profilePushInFlightRef = useRef(0);
  const activeProfilePushKeysRef = useRef(new Set<string>());
  const [assignBanner, setAssignBanner] = useState<ImageAsset | null>(null);
  const [assignBannerEmployees, setAssignBannerEmployees] = useState<Set<string>>(() => new Set());
  const [assignBannerAll, setAssignBannerAll] = useState(false);
  const [savingBannerAssign, setSavingBannerAssign] = useState(false);
  const [assignProfilePic, setAssignProfilePic] = useState<ImageAsset | null>(null);
  const [assignProfilePicEmployees, setAssignProfilePicEmployees] = useState<Set<string>>(() => new Set());
  const [assignProfilePicAll, setAssignProfilePicAll] = useState(false);
  const [savingProfilePicAssign, setSavingProfilePicAssign] = useState(false);
  const [assignBioItem, setAssignBioItem] = useState<Bio | null>(null);
  const [assignBioEmployees, setAssignBioEmployees] = useState<Set<string>>(() => new Set());
  const [assignBioAll, setAssignBioAll] = useState(false);
  const [savingBioAssign, setSavingBioAssign] = useState(false);
  const [editBioItem, setEditBioItem] = useState<Bio | null>(null);
  const [editBioText, setEditBioText] = useState('');
  const [savingBioEdit, setSavingBioEdit] = useState(false);
  const [addBioOpen, setAddBioOpen] = useState(false);
  const [savingBioAdd, setSavingBioAdd] = useState(false);
  const [picFile, setPicFile] = useState<File | null>(null);
  const [picCaption, setPicCaption] = useState('');
  const [proxyRaw, setProxyRaw] = useState('');
  const [proxyType, setProxyType] = useState('http');
  const [newProxyLabel, setNewProxyLabel] = useState('');
  const [proxySearch, setProxySearch] = useState('');
  const [bannerPushAccountIds, setBannerPushAccountIds] = useState<Set<string>>(() => new Set());
  const [bannerPushAllAccounts, setBannerPushAllAccounts] = useState(false);
  const [picPushAccountIds, setPicPushAccountIds] = useState<Set<string>>(() => new Set());
  const [picPushAllAccounts, setPicPushAllAccounts] = useState(false);
  const [picPushAccountId, setPicPushAccountId] = useState('');
  const [bioPushAccountIds, setBioPushAccountIds] = useState<Set<string>>(() => new Set());
  const [bioPushAllAccounts, setBioPushAllAccounts] = useState(false);
  const [directPicFile, setDirectPicFile] = useState<File | null>(null);
  const [profilePushing, setProfilePushing] = useState<string | null>(null);
  const [profilePushProgress, setProfilePushProgress] = useState<ProfilePushProgressState | null>(null);
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

  // Inline editing of a configured follow account.
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BskyAccount | null>(null);

  // Live run statuses written by every session, so each PC can see follow jobs
  // running elsewhere (other admins, employees, etc.).
  const [remoteRuns, setRemoteRuns] = useState<Record<string, BskyRun>>({});
  const [remoteWarmupRuns, setRemoteWarmupRuns] = useState<Record<string, BskyWarmupRun>>({});

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
  // Running cumulative follow count per `${accountId}:${dayKey}` so each tick
  // updates a single row instead of inserting a new one.
  const dayCountRef = useRef<Record<string, number>>({});
  // Mirror of followEvents for seeding dayCountRef without extra DB reads.
  const followEventsRef = useRef<BskyFollowEvent[]>([]);
  // Mirror of savedAccounts so long-running follow jobs can auto-ban the right
  // account even after the closure that started the job has gone stale.
  const savedAccountsRef = useRef<BskySavedAccount[]>([]);

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

  /** New library items created by employees are assigned to themselves so they appear in their view. */
  function newLibraryItemAssign() {
    if (session.role === 'employee') {
      return { employees: [session.username], allEmployees: false };
    }
    return { employees: [], allEmployees: false };
  }

  function ownsLibraryItem(item: { employees?: string[] }) {
    return isAdmin || (item.employees ?? []).includes(session.username);
  }

  const loadAll = useCallback(async () => {
    const [bn, pp, bi, po, px, ac, sa, tg, fe, sl] = await Promise.all([
      getBanners(ownerFilter),
      getProfilePics(ownerFilter),
      getBios(ownerFilter),
      getPosts(ownerFilter),
      getProxies(ownerFilter),
      getBskyAccounts(ownerFilter),
      getSavedAccounts(ownerFilter),
      getTargets(ownerFilter),
      getFollowEvents(),
      isAdmin ? getSlaveAccounts() : Promise.resolve([] as BskySlaveAccount[]),
    ]);
    setBanners(bn);
    setProfilePics(pp);
    setBios(bi);
    setPosts(po);
    setProxies(px);
    setAccounts(ac);
    setSavedAccounts(sa);
    setTargets(tg);
    setFollowEvents(fe);
    setSlaveAccounts(sl);
  }, [ownerFilter, isAdmin]);

  useEffect(() => {
    let active = true;
    if (hasLoadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    (async () => {
      try {
        if (isAdmin) {
          const emps = await getEmployees();
          if (!active) return;
          setEmployees(emps);
        }
        await loadAll();
        if (active) hasLoadedOnceRef.current = true;
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load Bluesky data');
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isAdmin, loadAll]);

  const displayedPosts = useMemo(() => {
    if (postMediaTab === 'engagement') return [];
    return posts.filter((post) => {
      const type = post.mediaType ?? (post.videoUrl ? 'video' : 'image');
      return type === postMediaTab;
    });
  }, [posts, postMediaTab]);

  const engagementPosts = useMemo(
    () => posts.filter((p) => (p.publishes ?? []).length > 0),
    [posts],
  );

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

  // Drain buffered follows into persisted events. Each account keeps ONE
  // cumulative row per day, so a busy run updates a single row instead of
  // flooding the table. Follows only count once written to the database; on a
  // failed write we roll back and re-queue so nothing is lost or left local.
  const flushFollowBuffer = useCallback(async () => {
    const buf = followBufferRef.current;
    if (buf.length === 0) return;
    followBufferRef.current = [];
    const now = Date.now();
    const key = dayKey(new Date(now));
    const deltas = new Map<string, number>();
    for (const b of buf) deltas.set(b.accountId, (deltas.get(b.accountId) ?? 0) + 1);
    const events: BskyFollowEvent[] = [];
    for (const [accountId, delta] of deltas) {
      const id = `${accountId}:${key}`;
      // Seed from the latest known value so we never overwrite with a lower count.
      if (dayCountRef.current[id] == null) {
        const known = followEventsRef.current.find((e) => e.id === id);
        dayCountRef.current[id] = known ? Number(known.count) : 0;
      }
      const next = dayCountRef.current[id] + delta;
      dayCountRef.current[id] = next;
      events.push({ id, accountId, count: next, capturedAt: now });
    }
    try {
      await addFollowEvents(events);
      setFollowEvents((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        for (const e of events) byId.set(e.id, e);
        return [...byId.values()];
      });
    } catch {
      // Roll back the in-memory cumulative and re-queue for the next tick.
      for (const [accountId, delta] of deltas) {
        const id = `${accountId}:${key}`;
        dayCountRef.current[id] = (dayCountRef.current[id] ?? delta) - delta;
      }
      followBufferRef.current.unshift(...buf);
    }
  }, []);

  // Keep a ref mirror of followEvents so the flush can seed cumulative counts.
  useEffect(() => {
    followEventsRef.current = followEvents;
  }, [followEvents]);

  // Keep a ref mirror of savedAccounts so auto-ban can resolve the right
  // account from inside long-running follow jobs.
  useEffect(() => {
    savedAccountsRef.current = savedAccounts;
  }, [savedAccounts]);

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

  // While the dashboard is open, poll shared follow data every second so the
  // totals + graph reflect follows run by other employees in real time.
  useEffect(() => {
    if (view !== 'dashboard') return;
    let active = true;
    const refresh = async () => {
      try {
        const [fe, ac, sa] = await Promise.all([
          getFollowEvents(),
          getBskyAccounts(ownerFilter),
          getSavedAccounts(ownerFilter),
        ]);
        if (!active) return;
        setFollowEvents((prev) => {
          const byId = new Map<string, BskyFollowEvent>();
          for (const e of prev) byId.set(e.id, e);
          // Cumulative day counts only ever grow, so keep the higher value to
          // avoid a momentary dip if the fetch lags a local write.
          for (const e of fe) {
            const cur = byId.get(e.id);
            if (!cur || Number(e.count) >= Number(cur.count)) byId.set(e.id, e);
          }
          return [...byId.values()].sort((a, b) => a.capturedAt - b.capturedAt);
        });
        setAccounts(ac);
        // Keep banned status (and the dashboard's banned count) live across
        // sessions, so an auto-ban on another PC shows up here too.
        setSavedAccounts(sa);
      } catch {
        // ignore transient fetch errors
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [view, ownerFilter]);

  // Reset the selected day whenever the visible month changes.
  useEffect(() => {
    setSelectedFollowDay(null);
  }, [chartMonthOffset]);

  // Poll shared run statuses so every session can see follow jobs running on
  // other PCs (other admins, or employees' devices). Runs without a recent
  // heartbeat are treated as stale and dropped.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const runs = await getRuns();
        if (!active) return;
        const map: Record<string, BskyRun> = {};
        for (const r of runs) map[r.accountId] = r;
        setRemoteRuns(map);
      } catch {
        // ignore transient fetch errors
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  // Poll shared warm-up statuses so every session can see warm-ups running on
  // other PCs, mirroring the follow-job indicator.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const runs = await getWarmupRuns();
        if (!active) return;
        const map: Record<string, BskyWarmupRun> = {};
        for (const r of runs) map[r.accountKey] = r;
        setRemoteWarmupRuns(map);
      } catch {
        // ignore transient fetch errors
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

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

  async function saveBioAdd() {
    if (!bioText.trim()) return;
    setSavingBioAdd(true);
    try {
      await addBio({
        id: crypto.randomUUID(),
        text: bioText.trim(),
        createdAt: Date.now(),
        ...newLibraryItemAssign(),
      });
      setBioText('');
      setAddBioOpen(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add bio.');
    } finally {
      setSavingBioAdd(false);
    }
  }

  function openAddBioModal() {
    setBioText('');
    setAddBioOpen(true);
  }

  function closeAddBioModal() {
    setAddBioOpen(false);
    setBioText('');
  }

  async function uploadPostMedia(file: File) {
    const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
    if (mediaType === 'video' && !file.type.includes('mp4')) {
      setError('Videos must be MP4 format.');
      return;
    }
    if (mediaType !== postMediaTab) {
      setError(`Switch to the ${mediaType} tab to add this file.`);
      return;
    }
    setUploading(true);
    try {
      await addPost(
        {
          id: crypto.randomUUID(),
          text: '',
          mediaType,
          ...newLibraryItemAssign(),
          createdAt: Date.now(),
          publishes: [],
        },
        file,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add post media.');
    } finally {
      setUploading(false);
    }
  }

  async function fetchPostMediaBlob(post: BskyPost): Promise<Blob> {
    const url = post.mediaType === 'video' ? post.videoUrl : post.imageUrl;
    if (!url) throw new Error('Post media not found.');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load post media.');
    return await res.blob();
  }

  function getAssignedOwnersForPost(post: BskyPost): string[] | null {
    const named = (post.employees ?? [])
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    if (named.length > 0) return named;
    if (post.allEmployees) {
      const all = employees.map((e) => e.username.trim().toLowerCase()).filter(Boolean);
      return all.length > 0 ? all : null;
    }
    return null;
  }

  function postableAccountsForPost(post: BskyPost): BskySavedAccount[] {
    const assignees = getAssignedOwnersForPost(post);
    if (!assignees) return pushableAccounts;
    const allowed = new Set(assignees);
    return pushableAccounts.filter((acct) => {
      const owner = (acct.owner ?? 'admin').trim().toLowerCase();
      return allowed.has(owner);
    });
  }

  function proxiesForPost(post: BskyPost): Proxy[] {
    const assignees = getAssignedOwnersForPost(post);
    if (!assignees) {
      if (isAdmin) return proxies;
      return proxies.filter((p) => session && matchesEmployee(p, session.username));
    }
    const allowed = new Set(assignees);
    return proxies.filter((p) => {
      if (p.allEmployees) return true;
      return assignedEmployees(p).some((u) => allowed.has(u.trim().toLowerCase()));
    });
  }

  function credentialsForPublish(acct: BskySavedAccount, proxyId?: string): BskyCredentials {
    const base = credentialsForSavedAccount(acct);
    if (proxyId) {
      return { ...base, proxy: proxyConfigFor(proxyId) };
    }
    return base;
  }

  function openPostPublishModal(post: BskyPost) {
    const availableProxies = proxiesForPost(post);
    setPostCaptionModal({ post });
    setPostCaptionText(post.text);
    setPostHashtagsText('');
    setPostPublishAccountIds(new Set());
    setPostPublishAllAccounts(false);
    setPostPublishProxyId(availableProxies.length === 1 ? availableProxies[0]!.id : '');
  }

  function closePostCaptionModal() {
    setPostCaptionModal(null);
    setPostCaptionText('');
    setPostHashtagsText('');
    setPostPublishAccountIds(new Set());
    setPostPublishAllAccounts(false);
    setPostPublishProxyId('');
  }

  // Combines the caption and the hashtags input into the final post text.
  // Hashtags may be entered with or without '#', separated by spaces or commas.
  function buildPostText(caption: string, hashtags: string): string {
    const tags = hashtags
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#+/, ''))
      .filter(Boolean)
      .map((t) => `#${t}`);
    const base = caption.trim();
    if (tags.length === 0) return base;
    return base ? `${base}\n\n${tags.join(' ')}` : tags.join(' ');
  }

  function openAssignPostModal(post: BskyPost) {
    setAssignPost(post);
    setAssignPostEmployees(new Set(post.employees ?? []));
    setAssignPostAll(Boolean(post.allEmployees));
  }

  function closeAssignPostModal() {
    setAssignPost(null);
    setAssignPostEmployees(new Set());
    setAssignPostAll(false);
  }

  function toggleAssignPostEmployee(username: string) {
    setAssignPostEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function savePostAssign() {
    if (!assignPost) return;
    setSavingPostAssign(true);
    try {
      await updatePost({
        ...assignPost,
        employees: assignPostAll ? [] : [...assignPostEmployees],
        allEmployees: assignPostAll,
      });
      await loadAll();
      closeAssignPostModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign post.');
    } finally {
      setSavingPostAssign(false);
    }
  }

  async function publishLibraryPost(
    post: BskyPost,
    caption: string,
    hashtags: string,
    proxyId: string,
    selectedAccountIds: Set<string>,
    allAccounts: boolean,
  ) {
    const finalText = buildPostText(caption, hashtags);
    const postable = postableAccountsForPost(post);
    const targets = allAccounts
      ? postable
      : postable.filter((a) => selectedAccountIds.has(a.id));
    if (targets.length === 0) {
      setError('Select at least one Bluesky account with saved credentials.');
      return;
    }

    const pushKey = post.id;
    setPostPublishingId(post.id);
    setPostPublishProgress({ pushKey, done: 0, total: targets.length, kind: 'post' });
    setError(null);
    setSuccessMessage(null);

    const newPublishes: BskyPostPublish[] = [];
    const failures: string[] = [];
    let ok = 0;

    try {
      const mediaBlob = await fetchPostMediaBlob(post);
      const mediaType = post.mediaType ?? (post.videoUrl ? 'video' : 'image');

      for (let i = 0; i < targets.length; i++) {
        const acct = targets[i]!;
        const handle = acct.handle.replace(/^@/, '');
        setPostPublishProgress({ pushKey, done: i, total: targets.length, currentHandle: handle, kind: 'post' });
        try {
          const published = await publishBskyMediaPost(credentialsForPublish(acct, proxyId || undefined), {
            text: finalText,
            file: mediaBlob,
            mediaType,
            fileName: mediaType === 'video' ? 'video.mp4' : 'image.jpg',
            onProgress: (message) => {
              setPostPublishProgress({
                pushKey,
                done: i,
                total: targets.length,
                currentHandle: `${handle} · ${message}`,
                kind: 'post',
              });
            },
          });
          newPublishes.push({
            accountId: acct.id,
            handle,
            uri: published.uri,
            cid: published.cid,
            publishedAt: Date.now(),
          });
          ok += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Post failed';
          failures.push(`@${handle}: ${msg}`);
          newPublishes.push({
            accountId: acct.id,
            handle,
            uri: '',
            cid: '',
            publishedAt: Date.now(),
            error: msg,
          });
        }
        setPostPublishProgress({ pushKey, done: i + 1, total: targets.length, kind: 'post' });
      }

      await updatePost({
        ...post,
        text: finalText,
        publishes: [...(post.publishes ?? []), ...newPublishes],
      });
      await loadAll();
      closePostCaptionModal();

      if (failures.length === 0) {
        setSuccessMessage(`Posted to ${ok} account${ok === 1 ? '' : 's'}.`);
        setPostMediaTab('engagement');
      } else if (ok > 0) {
        setError(
          `Posted to ${ok} account${ok === 1 ? '' : 's'}, but failed on ${failures.length}: ${failures.join(' · ')}`,
        );
        setPostMediaTab('engagement');
      } else {
        setError(failures.join(' · '));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish post.');
    } finally {
      setPostPublishingId(null);
      setPostPublishProgress(null);
    }
  }

  function downloadPost(post: BskyPost) {
    const url = post.mediaType === 'video' ? post.videoUrl : post.imageUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = post.mediaType === 'video' ? 'post.mp4' : 'post.jpg';
    link.rel = 'noreferrer';
    link.click();
  }

  function togglePostPublishAccount(id: string) {
    setPostPublishAllAccounts(false);
    setPostPublishAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshPostEngagement(post: BskyPost) {
    const published = (post.publishes ?? []).filter((p) => p.uri && !p.error);
    if (published.length === 0) return;
    setRefreshingPostStats(post.id);
    try {
      const updated: BskyPostPublish[] = [];
      for (const pub of post.publishes ?? []) {
        if (!pub.uri || pub.error) {
          updated.push(pub);
          continue;
        }
        const acct = pushableAccounts.find((a) => a.id === pub.accountId);
        if (!acct) {
          updated.push(pub);
          continue;
        }
        try {
          const stats = await getBskyPostEngagement(credentialsForSavedAccount(acct), pub.uri);
          updated.push({
            ...pub,
            likeCount: stats.likeCount,
            replyCount: stats.replyCount,
            repostCount: stats.repostCount,
            statsFetchedAt: Date.now(),
          });
        } catch (err) {
          updated.push(pub);
        }
      }
      await updatePost({ ...post, publishes: updated });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh engagement stats.');
    } finally {
      setRefreshingPostStats(null);
    }
  }

  // Removes the published post(s) from the Bluesky profile(s) but keeps the
  // underlying video/image in the library. Only clears the publish records
  // that were successfully deleted on Bluesky so failures can be retried.
  async function deleteProfilePost(post: BskyPost) {
    setDeletingProfilePost(post.id);
    setError(null);
    const remaining: BskyPostPublish[] = [];
    const failures: string[] = [];
    try {
      for (const pub of post.publishes ?? []) {
        if (!pub.uri || pub.error) continue;
        const acct = pushableAccounts.find((a) => a.id === pub.accountId);
        if (!acct) {
          remaining.push(pub);
          failures.push(`@${pub.handle.replace(/^@/, '')}: account not found`);
          continue;
        }
        try {
          await deleteBskyPost(credentialsForSavedAccount(acct), pub.uri);
        } catch (err) {
          remaining.push(pub);
          failures.push(
            `@${pub.handle.replace(/^@/, '')}: ${err instanceof Error ? err.message : 'delete failed'}`,
          );
        }
      }
      await updatePost({ ...post, publishes: remaining });
      await loadAll();
      if (failures.length > 0) {
        setError(`Could not remove some posts: ${failures.join(' · ')}`);
      } else {
        setSuccessMessage('Removed post from Bluesky. Video kept in library.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete post from Bluesky.');
    } finally {
      setDeletingProfilePost(null);
    }
  }

  // --- Slave accounts (mass like / repost pool) ---

  function credentialsForSlave(acct: BskySlaveAccount): BskyCredentials {
    return {
      identifier: acct.handle.trim().replace(/^@/, ''),
      password: acct.password.trim(),
      proxy: proxyConfigFor(acct.proxyId),
    };
  }

  async function handleUpdateSlaveProxy(acct: BskySlaveAccount, proxyId: string) {
    try {
      await addSlaveAccount({ ...acct, proxyId: proxyId || undefined });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update slave proxy.');
    }
  }

  async function handleAddSlaveAccount(event: FormEvent) {
    event.preventDefault();
    const handle = newSlaveHandle.trim().replace(/^@/, '');
    if (!handle || !newSlavePassword.trim()) return;
    if (slaveAccounts.some((a) => a.handle.toLowerCase() === handle.toLowerCase())) {
      setError(`Slave account "@${handle}" already exists`);
      return;
    }
    setSavingSlave(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const credentials: BskyCredentials = {
        identifier: handle,
        password: newSlavePassword.trim(),
        proxy: proxyConfigFor(newSlaveProxyId || undefined),
      };
      await verifyBskyLogin(credentials);
      await addSlaveAccount({
        id: crypto.randomUUID(),
        handle,
        password: newSlavePassword.trim(),
        proxyId: newSlaveProxyId || undefined,
        createdAt: Date.now(),
      });
      setNewSlaveHandle('');
      setNewSlavePassword('');
      setNewSlaveProxyId('');
      setShowAddSlave(false);
      await loadAll();
      setSuccessMessage(`Slave account @${handle} verified and added.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add slave account.');
    } finally {
      setSavingSlave(false);
    }
  }

  async function handleDeleteSlaveAccount(id: string) {
    try {
      await deleteSlaveAccount(id);
      setSelectedSlaveIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete slave account.');
    }
  }

  function toggleSlaveSelected(id: string) {
    setSelectedSlaveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllSlaves() {
    setSelectedSlaveIds((prev) =>
      prev.size === slaveAccounts.length ? new Set() : new Set(slaveAccounts.map((a) => a.id)),
    );
  }

  // Deletes the given slave account ids sequentially, then refreshes.
  async function deleteSlaveAccounts(ids: string[]) {
    if (ids.length === 0) return;
    setDeletingSlaves(true);
    setError(null);
    const failures: string[] = [];
    try {
      for (const id of ids) {
        try {
          await deleteSlaveAccount(id);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : 'delete failed');
        }
      }
      setSelectedSlaveIds(new Set());
      await loadAll();
      if (failures.length > 0) {
        setError(`Deleted ${ids.length - failures.length} of ${ids.length}. ${failures.length} failed.`);
      } else {
        setSuccessMessage(`Deleted ${ids.length} slave account${ids.length === 1 ? '' : 's'}.`);
      }
    } finally {
      setDeletingSlaves(false);
    }
  }

  async function handleDeleteSelectedSlaves() {
    const ids = slaveAccounts.filter((a) => selectedSlaveIds.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected slave account${ids.length === 1 ? '' : 's'}?`)) {
      return;
    }
    await deleteSlaveAccounts(ids);
  }

  async function handleDeleteAllSlaves() {
    if (slaveAccounts.length === 0) return;
    if (!window.confirm(`Delete ALL ${slaveAccounts.length} slave accounts? This cannot be undone.`)) {
      return;
    }
    await deleteSlaveAccounts(slaveAccounts.map((a) => a.id));
  }

  type WarmupRunRow = { key: string; id: string; handle: string };

  const followWarmupPool = useMemo(
    () => accounts.filter((a) => a.identifier?.trim() && a.password?.trim()),
    [accounts],
  );

  const followWarmupFiltered = useMemo(() => {
    if (!isAdmin || !warmupFollowEmployee) return followWarmupPool;
    return followWarmupPool.filter((a) => matchesEmployee(a, warmupFollowEmployee));
  }, [followWarmupPool, warmupFollowEmployee, isAdmin]);

  const slaveWarmupPool = useMemo(
    () => slaveAccounts.filter((a) => a.handle?.trim() && a.password?.trim()),
    [slaveAccounts],
  );

  const followWarmupPickerAccounts = useMemo(
    () =>
      followWarmupFiltered.map((a) => ({
        id: a.id,
        label: `@${a.identifier.trim().replace(/^@/, '')}`,
      })),
    [followWarmupFiltered],
  );

  const slaveWarmupPickerAccounts = useMemo(
    () =>
      slaveWarmupPool.map((a) => ({
        id: a.id,
        label: `@${a.handle.trim().replace(/^@/, '')}`,
      })),
    [slaveWarmupPool],
  );

  const selectedFollowWarmupRows = useMemo((): WarmupRunRow[] => {
    const pool = selectAllFollowWarmups
      ? followWarmupFiltered
      : followWarmupFiltered.filter((a) => selectedFollowWarmupIds.has(a.id));
    return pool.map((a) => ({
      key: `follow:${a.id}`,
      id: a.id,
      handle: a.identifier.trim().replace(/^@/, ''),
    }));
  }, [followWarmupFiltered, selectAllFollowWarmups, selectedFollowWarmupIds]);

  const selectedSlaveWarmupRows = useMemo((): WarmupRunRow[] => {
    const pool = selectAllSlaveWarmups
      ? slaveWarmupPool
      : slaveWarmupPool.filter((a) => selectedSlaveWarmupIds.has(a.id));
    return pool.map((a) => ({
      key: `slave:${a.id}`,
      id: a.id,
      handle: a.handle.trim().replace(/^@/, ''),
    }));
  }, [slaveWarmupPool, selectAllSlaveWarmups, selectedSlaveWarmupIds]);

  const activeWarmupRows =
    warmupTab === 'follow' ? selectedFollowWarmupRows : selectedSlaveWarmupRows;

  useEffect(() => {
    if (isAdmin && employees.length > 0 && !warmupFollowEmployee) {
      setWarmupFollowEmployee(employees[0].username);
    }
  }, [isAdmin, employees, warmupFollowEmployee]);

  useEffect(() => {
    setSelectedFollowWarmupIds(new Set());
    setSelectAllFollowWarmups(false);
  }, [warmupFollowEmployee]);

  useEffect(() => {
    if (!isAdmin && warmupTab === 'slave') setWarmupTab('follow');
  }, [isAdmin, warmupTab]);

  const visibleWarmupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const a of accounts) keys.add(`follow:${a.id}`);
    for (const s of slaveAccounts) keys.add(`slave:${s.id}`);
    return keys;
  }, [accounts, slaveAccounts]);

  function warmupSessionOwner(): string {
    return session.role === 'employee' ? session.username : 'admin';
  }

  function warmupCardFromRun(run: BskyWarmupRun): WarmupCardState {
    return {
      status: run.status,
      step: run.step,
      totalSteps: run.totalSteps,
      label: run.label,
      error: run.error,
    };
  }

  function isWarmupRunInProgress(run: BskyWarmupRun): boolean {
    return run.active && (run.status === 'waiting' || run.status === 'running');
  }

  function isWarmupRunVisible(run: BskyWarmupRun, now = Date.now()): boolean {
    if (!visibleWarmupKeys.has(run.accountKey)) return false;
    if (isWarmupRunInProgress(run)) return true;
    const recentDone =
      !run.active &&
      (run.status === 'done' || run.status === 'error') &&
      now - run.updatedAt < WARMUP_DONE_FLASH_MS;
    return recentDone;
  }

  function clearFinishedWarmupRow(row: WarmupRunRow, delayMs = 0) {
    const remove = () => {
      void deleteWarmupRun(row.key).catch(() => {});
      setWarmupCardProgress((prev) => {
        if (!prev[row.key]) return prev;
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
    };
    if (delayMs <= 0) remove();
    else window.setTimeout(remove, delayMs);
  }

  function isWarmupRowBusy(key: string): boolean {
    const remote = remoteWarmupRuns[key];
    if (remote && isWarmupRunInProgress(remote)) return true;
    const local = warmupCardProgress[key];
    return local?.status === 'waiting' || local?.status === 'running';
  }

  const startableWarmupRows = useMemo(
    () => activeWarmupRows.filter((row) => !isWarmupRowBusy(row.key)),
    [activeWarmupRows, remoteWarmupRuns, warmupCardProgress],
  );

  const activeSlaveWarmupCount = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, card] of Object.entries(warmupCardProgress)) {
      if (!key.startsWith('slave:')) continue;
      if (card.status === 'waiting' || card.status === 'running') keys.add(key);
    }
    for (const run of Object.values(remoteWarmupRuns)) {
      if (run.accountKey.startsWith('slave:') && isWarmupRunInProgress(run)) {
        keys.add(run.accountKey);
      }
    }
    return keys.size;
  }, [warmupCardProgress, remoteWarmupRuns]);

  function needsWarmupExecutor(run: BskyWarmupRun, now = Date.now()): boolean {
    if (!run.active) return false;
    if (run.status === 'done' || run.status === 'error') return false;
    if (run.status === 'waiting') return true;
    if (run.status !== 'running') return false;
    if (run.claimedBy === warmupClientIdRef.current) return true;
    if (run.claimedBy?.startsWith('client-') && now - run.updatedAt < RUN_STALE_MS) {
      return false;
    }
    if (run.claimedBy === 'server' && now - run.updatedAt < RUN_STALE_MS) return false;
    return now - run.updatedAt >= 3000;
  }

  function warmupRowFromRun(run: BskyWarmupRun): WarmupRunRow {
    const prefix = run.kind === 'slave' ? 'slave:' : 'follow:';
    return {
      key: run.accountKey,
      id: run.accountKey.startsWith(prefix) ? run.accountKey.slice(prefix.length) : run.accountKey,
      handle: run.handle,
    };
  }

  function warmupRowFromKey(key: string): WarmupRunRow {
    const remote = remoteWarmupRuns[key];
    if (remote) return warmupRowFromRun(remote);
    const prefix = key.startsWith('slave:') ? 'slave:' : 'follow:';
    const id = key.slice(prefix.length);
    const handle =
      (key.startsWith('slave:')
        ? slaveAccounts.find((s) => s.id === id)?.handle
        : accounts.find((a) => a.id === id)?.identifier) ?? key;
    return { key, id, handle: handle.replace(/^@/, '') };
  }

  function collectActiveSlaveWarmupKeys(): string[] {
    const keys = new Set<string>();
    for (const key of warmupExecutorKeysRef.current) {
      if (key.startsWith('slave:')) keys.add(key);
    }
    for (const [key, card] of Object.entries(warmupCardProgress)) {
      if (!key.startsWith('slave:')) continue;
      if (card.status === 'waiting' || card.status === 'running') keys.add(key);
    }
    for (const run of Object.values(remoteWarmupRuns)) {
      if (run.accountKey.startsWith('slave:') && isWarmupRunInProgress(run)) {
        keys.add(run.accountKey);
      }
    }
    return [...keys];
  }

  function stopAllSlaveWarmups() {
    const keys = collectActiveSlaveWarmupKeys();
    if (keys.length === 0) return;
    warmupStopRequestedRef.current = true;
    for (const key of keys) warmupCancelRef.current[key] = true;
    for (const key of keys) {
      const card = warmupCardProgress[key];
      if (card?.status === 'waiting') {
        clearFinishedWarmupRow(warmupRowFromKey(key), 0);
      } else if (card?.status === 'running') {
        setWarmupCardProgress((prev) => ({
          ...prev,
          [key]: { ...prev[key]!, label: 'Stopping…' },
        }));
      } else {
        void deleteWarmupRun(key).catch(() => {});
      }
    }
    setSuccessMessage(`Stopping ${keys.length} slave warm-up${keys.length === 1 ? '' : 's'}…`);
  }

  function persistWarmupRun(
    row: WarmupRunRow,
    card: WarmupCardState,
    active: boolean,
    force = false,
    queueOrder?: number,
  ) {
    const now = Date.now();
    const last = warmupWriteTimesRef.current[row.key] ?? 0;
    if (!force && now - last < 1500) return;
    warmupWriteTimesRef.current[row.key] = now;
    const status: BskyWarmupRun['status'] =
      card.status === 'ready' || card.status === 'waiting'
        ? 'waiting'
        : card.status === 'running' ||
            card.status === 'done' ||
            card.status === 'error'
          ? card.status
          : 'waiting';
    const existingOrder = remoteWarmupRuns[row.key]?.queueOrder;
    void upsertWarmupRun({
      accountKey: row.key,
      handle: row.handle,
      kind: row.key.startsWith('slave:') ? 'slave' : 'follow',
      status,
      step: card.step,
      totalSteps: card.totalSteps,
      label: card.label,
      error: card.error,
      owner: warmupSessionOwner(),
      active,
      updatedAt: now,
      claimedBy: warmupClientIdRef.current,
      queueOrder: queueOrder ?? existingOrder,
    }).catch(() => {});
  }

  function warmupQueueOrderForKey(key: string, fallback = 0): number {
    return remoteWarmupRuns[key]?.queueOrder ?? fallback;
  }

  function sortWarmupRowsByQueue(rows: WarmupRunRow[]): WarmupRunRow[] {
    const fallbackOrder = new Map(rows.map((r, i) => [r.key, i]));
    return [...rows].sort((a, b) => {
      const orderA = remoteWarmupRuns[a.key]?.queueOrder ?? fallbackOrder.get(a.key) ?? 0;
      const orderB = remoteWarmupRuns[b.key]?.queueOrder ?? fallbackOrder.get(b.key) ?? 0;
      return orderA - orderB;
    });
  }

  const displayWarmupRowsForTab = useMemo((): WarmupRunRow[] => {
    const prefix = warmupTab === 'follow' ? 'follow:' : 'slave:';
    const byKey = new Map<string, WarmupRunRow>();
    const now = Date.now();
    for (const run of Object.values(remoteWarmupRuns)) {
      if (!run.accountKey.startsWith(prefix)) continue;
      if (!isWarmupRunInProgress(run) && !isWarmupRunVisible(run, now)) continue;
      byKey.set(run.accountKey, {
        key: run.accountKey,
        id: run.accountKey.slice(prefix.length),
        handle: run.handle,
      });
    }
    for (const [key, card] of Object.entries(warmupCardProgress)) {
      if (!key.startsWith(prefix)) continue;
      if (card.status !== 'waiting' && card.status !== 'running' && card.status !== 'done' && card.status !== 'error') {
        continue;
      }
      if (card.status === 'done') continue;
      if (card.status === 'error' && !isAccountTakedownError(card.error)) continue;
      const handle =
        remoteWarmupRuns[key]?.handle ??
        accounts.find((a) => `follow:${a.id}` === key)?.identifier.replace(/^@/, '') ??
        slaveAccounts.find((s) => `slave:${s.id}` === key)?.handle.replace(/^@/, '') ??
        key;
      byKey.set(key, {
        key,
        id: key.slice(prefix.length),
        handle: handle.replace(/^@/, ''),
      });
    }
    return [...byKey.values()].sort(
      (a, b) => warmupQueueOrderForKey(a.key) - warmupQueueOrderForKey(b.key),
    );
  }, [
    warmupTab,
    remoteWarmupRuns,
    warmupCardProgress,
    visibleWarmupKeys,
    accounts,
    slaveAccounts,
  ]);

  useEffect(() => {
    const now = Date.now();
    setWarmupCardProgress((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const run of Object.values(remoteWarmupRuns)) {
        if (!visibleWarmupKeys.has(run.accountKey)) continue;
        if (warmupExecutorKeysRef.current.has(run.accountKey)) continue;
        if (!isWarmupRunInProgress(run)) {
          if (
            (run.status === 'done' || run.status === 'error') &&
            now - run.updatedAt >= WARMUP_DONE_FLASH_MS
          ) {
            void deleteWarmupRun(run.accountKey).catch(() => {});
          }
          continue;
        }
        const card = warmupCardFromRun(run);
        const prevCard = next[run.accountKey];
        if (
          !prevCard ||
          prevCard.status !== card.status ||
          prevCard.step !== card.step ||
          prevCard.label !== card.label ||
          prevCard.error !== card.error
        ) {
          next[run.accountKey] = card;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [remoteWarmupRuns, visibleWarmupKeys]);

  // Drop finished warm-up rows from shared storage so they don't block the UI.
  useEffect(() => {
    for (const run of Object.values(remoteWarmupRuns)) {
      if (!visibleWarmupKeys.has(run.accountKey)) continue;
      if (run.active) continue;
      if (run.status === 'done' || run.status === 'error') {
        void deleteWarmupRun(run.accountKey).catch(() => {});
      }
    }
  }, [remoteWarmupRuns, visibleWarmupKeys]);

  useEffect(() => {
    warmupCardProgressRef.current = warmupCardProgress;
  }, [warmupCardProgress]);

  async function runWarmupOne(
    row: WarmupRunRow,
    options: { resume?: boolean; queueOrder: number },
  ): Promise<string | null> {
    if (warmupCancelRef.current[row.key]) {
      clearFinishedWarmupRow(row, 0);
      return null;
    }

    const remote = remoteWarmupRuns[row.key];
    const creds = warmupCredentialsForRow(row);
    if (!creds) {
      const errCard: WarmupCardState = {
        status: 'error',
        step: 0,
        totalSteps: WARMUP_STEP_COUNT,
        label: 'Failed',
        error: 'Missing credentials',
      };
      setWarmupCardProgress((prev) => ({ ...prev, [row.key]: errCard }));
      persistWarmupRun(row, errCard, false, true, options.queueOrder);
      clearFinishedWarmupRow(row, WARMUP_DONE_FLASH_MS);
      return `@${row.handle}: missing credentials`;
    }

    const resumeStep = remote?.step ?? 0;
    const startFromStepIndex =
      options.resume && resumeStep > 0
        ? Math.max(0, Math.min(resumeStep - 1, WARMUP_STEP_COUNT - 1))
        : 0;

    const runningCard: WarmupCardState = {
      status: 'running',
      step: resumeStep,
      totalSteps: WARMUP_STEP_COUNT,
      label: startFromStepIndex > 0 ? 'Resuming warm-up…' : 'Signing in…',
    };
    setWarmupCardProgress((prev) => ({ ...prev, [row.key]: runningCard }));
    persistWarmupRun(row, runningCard, true, true, options.queueOrder);

    let lastStep = resumeStep;
    const heartbeat = setInterval(() => {
      const card = warmupCardProgressRef.current[row.key];
      if (!card) return;
      persistWarmupRun(row, card, true, true, options.queueOrder);
    }, 2000);

    try {
      const res = await runAccountWarmup(
        creds,
        {
          onProgress: (p) => {
            lastStep = p.step;
            const card: WarmupCardState = {
              status: 'running',
              step: p.step,
              totalSteps: p.totalSteps,
              label: p.label,
            };
            setWarmupCardProgress((prev) => ({ ...prev, [row.key]: card }));
            persistWarmupRun(row, card, true, false, options.queueOrder);
          },
          shouldCancel: () => warmupCancelRef.current[row.key] === true,
        },
        { startFromStepIndex },
      );

      if (res.cancelled || warmupCancelRef.current[row.key]) {
        delete warmupCancelRef.current[row.key];
        clearFinishedWarmupRow(row, 0);
        return null;
      }

      if (!res.ok) {
        const err = res.error ?? 'warm-up failed';
        const errCard: WarmupCardState = {
          status: 'error',
          step: lastStep,
          totalSteps: WARMUP_STEP_COUNT,
          label: 'Failed',
          error: err,
        };
        setWarmupCardProgress((prev) => ({ ...prev, [row.key]: errCard }));
        persistWarmupRun(row, errCard, false, true, options.queueOrder);
        if (!isAccountTakedownError(err)) {
          clearFinishedWarmupRow(row, WARMUP_DONE_FLASH_MS);
        }
        return `@${row.handle}: ${err}`;
      }

      const doneCard: WarmupCardState = {
        status: 'done',
        step: WARMUP_STEP_COUNT,
        totalSteps: WARMUP_STEP_COUNT,
        label: 'Completed',
      };
      setWarmupCardProgress((prev) => ({ ...prev, [row.key]: doneCard }));
      persistWarmupRun(row, doneCard, false, true, options.queueOrder);
      clearFinishedWarmupRow(row, WARMUP_DONE_FLASH_MS);
      return null;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function runWarmupQueue(rows: WarmupRunRow[], options: { resume?: boolean } = {}) {
    if (rows.length === 0) return;
    const ordered = options.resume ? sortWarmupRowsByQueue(rows) : rows;
    setWarmupRunning(true);
    setError(null);
    if (!options.resume) setSuccessMessage(null);
    warmupExecutorKeysRef.current = new Set(ordered.map((r) => r.key));

    if (!options.resume) {
      const initialCards: Record<string, WarmupCardState> = {};
      ordered.forEach((row, index) => {
        warmupCancelRef.current[row.key] = false;
        initialCards[row.key] = {
          status: 'waiting',
          step: 0,
          totalSteps: WARMUP_STEP_COUNT,
          label: 'Waiting…',
        };
        persistWarmupRun(row, initialCards[row.key], true, true, index);
      });
      setWarmupCardProgress((prev) => ({ ...prev, ...initialCards }));
    }

    const failures: string[] = [];
    let cursor = 0;
    let activeWorkers = 0;

    await new Promise<void>((resolve) => {
      const launch = () => {
        while (activeWorkers < WARMUP_CONCURRENCY && cursor < ordered.length) {
          const row = ordered[cursor];
          cursor += 1;
          if (warmupCancelRef.current[row.key]) {
            clearFinishedWarmupRow(row, 0);
            continue;
          }
          const queueOrder = options.resume
            ? warmupQueueOrderForKey(row.key, cursor - 1)
            : cursor - 1;
          activeWorkers += 1;
          void runWarmupOne(row, { resume: options.resume, queueOrder }).then((failure) => {
            if (failure) failures.push(failure);
            activeWorkers -= 1;
            if (cursor >= ordered.length && activeWorkers === 0) resolve();
            else launch();
          });
        }
        if (ordered.length === 0 || (cursor >= ordered.length && activeWorkers === 0)) resolve();
      };
      launch();
    });

    const stopped = warmupStopRequestedRef.current;
    warmupStopRequestedRef.current = false;

    if (!options.resume) {
      if (stopped) {
        setSuccessMessage('Warm-up stopped.');
      } else if (failures.length > 0) {
        setError(
          `Warm-up finished with ${failures.length} error${failures.length === 1 ? '' : 's'}: ${failures.slice(0, 3).join(' · ')}`,
        );
      } else {
        setSuccessMessage(
          `Warm-up completed for ${ordered.length} account${ordered.length === 1 ? '' : 's'}.`,
        );
      }
    } else if (failures.length > 0) {
      setError(
        `Resumed warm-up finished with ${failures.length} error${failures.length === 1 ? '' : 's'}: ${failures.slice(0, 3).join(' · ')}`,
      );
    }

    warmupExecutorKeysRef.current = new Set();
    setWarmupRunning(false);
  }

  async function startWarmup() {
    const selected = startableWarmupRows;
    if (selected.length === 0) {
      if (activeWarmupRows.length > 0) {
        setError('Selected accounts are already warming up. Pick accounts not in the queue.');
      } else {
        setError('Select at least one account to warm up.');
      }
      return;
    }
    await runWarmupQueue(selected);
  }

  useEffect(() => {
    if (loading || warmupRunning || warmupResumeLockRef.current) return;

    const now = Date.now();
    const orphans = sortWarmupRowsByQueue(
      Object.values(remoteWarmupRuns)
        .filter((r) => visibleWarmupKeys.has(r.accountKey) && needsWarmupExecutor(r, now))
        .map(warmupRowFromRun),
    );

    if (orphans.length === 0) return;

    // Let the browser orchestrator handle the queue; server only fills gaps when idle.
    const freshClientRunning = Object.values(remoteWarmupRuns).some(
      (r) =>
        r.active &&
        r.status === 'running' &&
        r.claimedBy?.startsWith('client-') &&
        now - r.updatedAt < RUN_STALE_MS,
    );
    if (freshClientRunning) return;

    warmupResumeLockRef.current = true;

    const rows = orphans;
    const resume = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
          await navigator.locks.request('bsky-warmup-executor', async () => {
            await runWarmupQueue(rows, { resume: true });
          });
        } else {
          await runWarmupQueue(rows, { resume: true });
        }
      } finally {
        warmupResumeLockRef.current = false;
      }
    };

    void resume();
  }, [remoteWarmupRuns, visibleWarmupKeys, loading, warmupRunning, accounts, slaveAccounts]);

  function credentialsForFollowAccount(acct: BskyAccount): BskyCredentials {
    return {
      identifier: acct.identifier.trim().replace(/^@/, ''),
      password: acct.password.trim(),
      proxy: proxyConfigFor(acct.proxyId),
    };
  }

  function warmupCredentialsForRow(row: WarmupRunRow): BskyCredentials | null {
    if (row.key.startsWith('slave:')) {
      const acct = slaveAccounts.find((s) => s.id === row.id);
      return acct ? credentialsForSlave(acct) : null;
    }
    const acct = accounts.find((a) => a.id === row.id);
    return acct ? credentialsForFollowAccount(acct) : null;
  }

  function toggleFollowWarmupSelected(id: string) {
    setSelectAllFollowWarmups(false);
    setSelectedFollowWarmupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSlaveWarmupSelected(id: string) {
    setSelectAllSlaveWarmups(false);
    setSelectedSlaveWarmupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function warmupCardPercent(card: WarmupCardState | undefined): number {
    if (!card) return 0;
    if (card.status === 'done') return 100;
    if (card.status === 'ready' || card.status === 'waiting') return 0;
    if (card.totalSteps <= 0) return 0;
    return Math.min(100, Math.round((card.step / card.totalSteps) * 100));
  }

  function isAccountTakedownError(message?: string): boolean {
    return /taken\s*down|takedown|accountsuspended|account\s*suspended/i.test(message ?? '');
  }

  async function handleDeleteTakedownWarmupAccount(row: WarmupRunRow) {
    const label = `@${row.handle}`;
    if (
      !window.confirm(
        `Delete ${label} from the app? This permanently removes the account from your lists.`,
      )
    ) {
      return;
    }
    setDeletingWarmupKey(row.key);
    setError(null);
    try {
      if (row.key.startsWith('slave:')) {
        await deleteSlaveAccount(row.id);
      } else {
        await deleteBskyAccount(row.id);
        const norm = row.handle.toLowerCase();
        const saved = savedAccounts.find(
          (a) => a.handle.trim().replace(/^@/, '').toLowerCase() === norm,
        );
        if (saved) await deleteSavedAccount(saved.id);
      }
      setSelectedFollowWarmupIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setSelectedSlaveWarmupIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setWarmupCardProgress((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      void deleteWarmupRun(row.key).catch(() => {});
      setSuccessMessage(`${label} removed from the app.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account.');
    } finally {
      setDeletingWarmupKey(null);
    }
  }

  function renderWarmupBubbleCards(rows: WarmupRunRow[]) {
    if (rows.length === 0) return null;
    return (
      <div className="warmup-cards-grid">
        {rows.map((row) => {
          const card =
            warmupCardProgress[row.key] ??
            ({
              status: 'ready',
              step: 0,
              totalSteps: WARMUP_STEP_COUNT,
              label: 'Ready to start',
            } satisfies WarmupCardState);
          const percent = warmupCardPercent(card);
          const statusLabel =
            card.status === 'ready'
              ? 'Ready'
              : card.status === 'waiting'
                ? 'Waiting'
                : card.status === 'running'
                  ? 'Running'
                  : card.status === 'done'
                    ? 'Done'
                    : 'Error';
          return (
            <div
              key={row.key}
              className={`warmup-bubble-card warmup-bubble-card--${card.status}`}
            >
              <div className="warmup-bubble-card__head">
                <strong className="warmup-bubble-card__handle">@{row.handle}</strong>
                <span className={`warmup-bubble-card__status warmup-bubble-card__status--${card.status}`}>
                  {statusLabel}
                </span>
              </div>
              <div className="publish-progress warmup-bubble-card__progress">
                <div className="publish-progress__track">
                  <div className="publish-progress__fill" style={{ width: `${percent}%` }} />
                </div>
                <span className="publish-progress__label">
                  {card.status === 'running' || card.status === 'done'
                    ? `Step ${card.step}/${card.totalSteps} · ${card.label}`
                    : card.label}
                </span>
              </div>
              {card.error && <p className="warmup-bubble-card__error">{card.error}</p>}
              {card.status === 'error' && isAccountTakedownError(card.error) && (
                <button
                  type="button"
                  className="btn btn--danger warmup-bubble-card__delete"
                  disabled={deletingWarmupKey === row.key || warmupRunning}
                  onClick={() => void handleDeleteTakedownWarmupAccount(row)}
                >
                  {deletingWarmupKey === row.key ? 'Deleting…' : 'Delete account'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function engagementInput(postId: string): { like: string; repost: string } {
    return engagementInputs[postId] ?? { like: '', repost: '' };
  }

  function setEngagementInput(postId: string, field: 'like' | 'repost', value: string) {
    const digits = value.replace(/[^0-9]/g, '');
    const clamped =
      digits === '' ? '' : String(Math.min(parseInt(digits, 10), slaveAccounts.length));
    setEngagementInputs((prev) => ({
      ...prev,
      [postId]: { ...engagementInput(postId), [field]: clamped },
    }));
  }

  function setMassStatus(postId: string, label: string | null) {
    setMassActionStatus((prev) => {
      const next = { ...prev };
      if (label === null) delete next[postId];
      else next[postId] = label;
      return next;
    });
  }

  // Likes every successful publish of `post` with up to `count` slave accounts
  // (skipping any that already liked it). Records the like URIs so they can be undone.
  async function massLikePost(post: BskyPost, count: number) {
    const n = Math.min(count, slaveAccounts.length);
    if (n <= 0) return;
    setMassStatus(post.id, 'Liking…');
    setError(null);
    setSuccessMessage(null);
    const failures: string[] = [];
    let done = 0;
    try {
      const publishes = [...(post.publishes ?? [])];
      for (let pi = 0; pi < publishes.length; pi++) {
        const pub = publishes[pi]!;
        if (!pub.uri || pub.error) continue;
        const already = new Set((pub.slaveLikes ?? []).map((s) => s.accountId));
        const candidates = slaveAccounts
          .filter((s) => !already.has(s.id))
          .slice(0, Math.max(0, n - already.size));
        const likes = [...(pub.slaveLikes ?? [])];
        for (const slave of candidates) {
          setMassStatus(post.id, `Liking… @${slave.handle.replace(/^@/, '')}`);
          try {
            const recordUri = await likeBskyPost(credentialsForSlave(slave), pub.uri, pub.cid);
            likes.push({ accountId: slave.id, handle: slave.handle, recordUri });
            done += 1;
          } catch (err) {
            failures.push(
              `@${slave.handle.replace(/^@/, '')}: ${err instanceof Error ? err.message : 'like failed'}`,
            );
          }
        }
        publishes[pi] = { ...pub, slaveLikes: likes };
      }
      const updatedPost = { ...post, publishes };
      await updatePost(updatedPost);
      await loadAll();
      await refreshPostEngagement(updatedPost);
      if (failures.length > 0) {
        setError(`Liked with ${done}, failed ${failures.length}: ${failures.slice(0, 5).join(' · ')}`);
      } else {
        setSuccessMessage(`Liked from ${done} slave account${done === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mass like failed.');
    } finally {
      setMassStatus(post.id, null);
    }
  }

  // Reposts every successful publish of `post` with up to `count` slave accounts.
  async function massRepostPost(post: BskyPost, count: number) {
    const n = Math.min(count, slaveAccounts.length);
    if (n <= 0) return;
    setMassStatus(post.id, 'Reposting…');
    setError(null);
    setSuccessMessage(null);
    const failures: string[] = [];
    let done = 0;
    try {
      const publishes = [...(post.publishes ?? [])];
      for (let pi = 0; pi < publishes.length; pi++) {
        const pub = publishes[pi]!;
        if (!pub.uri || pub.error) continue;
        const already = new Set((pub.slaveReposts ?? []).map((s) => s.accountId));
        const candidates = slaveAccounts
          .filter((s) => !already.has(s.id))
          .slice(0, Math.max(0, n - already.size));
        const reposts = [...(pub.slaveReposts ?? [])];
        for (const slave of candidates) {
          setMassStatus(post.id, `Reposting… @${slave.handle.replace(/^@/, '')}`);
          try {
            const recordUri = await repostBskyPost(credentialsForSlave(slave), pub.uri, pub.cid);
            reposts.push({ accountId: slave.id, handle: slave.handle, recordUri });
            done += 1;
          } catch (err) {
            failures.push(
              `@${slave.handle.replace(/^@/, '')}: ${err instanceof Error ? err.message : 'repost failed'}`,
            );
          }
        }
        publishes[pi] = { ...pub, slaveReposts: reposts };
      }
      const updatedPost = { ...post, publishes };
      await updatePost(updatedPost);
      await loadAll();
      await refreshPostEngagement(updatedPost);
      if (failures.length > 0) {
        setError(`Reposted with ${done}, failed ${failures.length}: ${failures.slice(0, 5).join(' · ')}`);
      } else {
        setSuccessMessage(`Reposted from ${done} slave account${done === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mass repost failed.');
    } finally {
      setMassStatus(post.id, null);
    }
  }

  // Undoes all slave likes recorded on a post.
  async function massUnlikePost(post: BskyPost) {
    setMassStatus(post.id, 'Removing likes…');
    setError(null);
    setSuccessMessage(null);
    const failures: string[] = [];
    let removed = 0;
    try {
      const publishes = [...(post.publishes ?? [])];
      for (let pi = 0; pi < publishes.length; pi++) {
        const pub = publishes[pi]!;
        const remaining: typeof pub.slaveLikes = [];
        for (const like of pub.slaveLikes ?? []) {
          const slave = slaveAccounts.find((s) => s.id === like.accountId);
          if (!slave) continue; // account removed — can't undo, drop the record
          setMassStatus(post.id, `Removing likes… @${slave.handle.replace(/^@/, '')}`);
          try {
            await unlikeBskyPost(credentialsForSlave(slave), like.recordUri);
            removed += 1;
          } catch (err) {
            remaining.push(like);
            failures.push(
              `@${slave.handle.replace(/^@/, '')}: ${err instanceof Error ? err.message : 'unlike failed'}`,
            );
          }
        }
        publishes[pi] = { ...pub, slaveLikes: remaining };
      }
      const updatedPost = { ...post, publishes };
      await updatePost(updatedPost);
      await loadAll();
      await refreshPostEngagement(updatedPost);
      if (failures.length > 0) {
        setError(`Removed ${removed} likes, failed ${failures.length}: ${failures.slice(0, 5).join(' · ')}`);
      } else {
        setSuccessMessage(`Removed ${removed} like${removed === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove likes.');
    } finally {
      setMassStatus(post.id, null);
    }
  }

  // Undoes all slave reposts recorded on a post.
  async function massUnrepostPost(post: BskyPost) {
    setMassStatus(post.id, 'Removing reposts…');
    setError(null);
    setSuccessMessage(null);
    const failures: string[] = [];
    let removed = 0;
    try {
      const publishes = [...(post.publishes ?? [])];
      for (let pi = 0; pi < publishes.length; pi++) {
        const pub = publishes[pi]!;
        const remaining: typeof pub.slaveReposts = [];
        for (const repost of pub.slaveReposts ?? []) {
          const slave = slaveAccounts.find((s) => s.id === repost.accountId);
          if (!slave) continue;
          setMassStatus(post.id, `Removing reposts… @${slave.handle.replace(/^@/, '')}`);
          try {
            await unrepostBskyPost(credentialsForSlave(slave), repost.recordUri);
            removed += 1;
          } catch (err) {
            remaining.push(repost);
            failures.push(
              `@${slave.handle.replace(/^@/, '')}: ${err instanceof Error ? err.message : 'un-repost failed'}`,
            );
          }
        }
        publishes[pi] = { ...pub, slaveReposts: remaining };
      }
      const updatedPost = { ...post, publishes };
      await updatePost(updatedPost);
      await loadAll();
      await refreshPostEngagement(updatedPost);
      if (failures.length > 0) {
        setError(`Removed ${removed} reposts, failed ${failures.length}: ${failures.slice(0, 5).join(' · ')}`);
      } else {
        setSuccessMessage(`Removed ${removed} repost${removed === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove reposts.');
    } finally {
      setMassStatus(post.id, null);
    }
  }

  async function uploadBanner(file: File) {
    setUploading(true);
    try {
      await addBanner(
        { id: crypto.randomUUID(), url: '', createdAt: Date.now(), ...newLibraryItemAssign() },
        file,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add banner.');
    } finally {
      setUploading(false);
    }
  }

  async function uploadProfilePic(file: File) {
    setUploading(true);
    try {
      await addProfilePic(
        { id: crypto.randomUUID(), url: '', createdAt: Date.now(), ...newLibraryItemAssign() },
        file,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add profile picture.');
    } finally {
      setUploading(false);
    }
  }

  function openAssignBannerModal(banner: ImageAsset) {
    setAssignBanner(banner);
    setAssignBannerEmployees(new Set(banner.employees ?? []));
    setAssignBannerAll(Boolean(banner.allEmployees));
  }

  function closeAssignBannerModal() {
    setAssignBanner(null);
    setAssignBannerEmployees(new Set());
    setAssignBannerAll(false);
  }

  function toggleAssignBannerEmployee(username: string) {
    setAssignBannerEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function saveBannerAssign() {
    if (!assignBanner) return;
    setSavingBannerAssign(true);
    try {
      await updateBanner({
        ...assignBanner,
        employees: assignBannerAll ? [] : [...assignBannerEmployees],
        allEmployees: assignBannerAll,
      });
      await loadAll();
      closeAssignBannerModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign banner.');
    } finally {
      setSavingBannerAssign(false);
    }
  }

  function openAssignProfilePicModal(item: ImageAsset) {
    setAssignProfilePic(item);
    setAssignProfilePicEmployees(new Set(item.employees ?? []));
    setAssignProfilePicAll(Boolean(item.allEmployees));
  }

  function closeAssignProfilePicModal() {
    setAssignProfilePic(null);
    setAssignProfilePicEmployees(new Set());
    setAssignProfilePicAll(false);
  }

  function toggleAssignProfilePicEmployee(username: string) {
    setAssignProfilePicEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  async function saveProfilePicAssign() {
    if (!assignProfilePic) return;
    setSavingProfilePicAssign(true);
    try {
      await updateProfilePic({
        ...assignProfilePic,
        employees: assignProfilePicAll ? [] : [...assignProfilePicEmployees],
        allEmployees: assignProfilePicAll,
      });
      await loadAll();
      closeAssignProfilePicModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign profile picture.');
    } finally {
      setSavingProfilePicAssign(false);
    }
  }

  function openAssignBioModal(bio: Bio) {
    setAssignBioItem(bio);
    setAssignBioEmployees(new Set(bio.employees ?? []));
    setAssignBioAll(Boolean(bio.allEmployees));
  }

  function closeAssignBioModal() {
    setAssignBioItem(null);
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
    if (!assignBioItem) return;
    setSavingBioAssign(true);
    try {
      await updateBio({
        ...assignBioItem,
        employees: assignBioAll ? [] : [...assignBioEmployees],
        allEmployees: assignBioAll,
      });
      await loadAll();
      closeAssignBioModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign bio.');
    } finally {
      setSavingBioAssign(false);
    }
  }

  function openEditBioModal(bio: Bio) {
    setEditBioItem(bio);
    setEditBioText(bio.text);
  }

  function closeEditBioModal() {
    setEditBioItem(null);
    setEditBioText('');
  }

  async function saveBioEdit() {
    if (!editBioItem) return;
    const text = editBioText.trim();
    if (!text) return;
    setSavingBioEdit(true);
    try {
      await updateBio({
        ...editBioItem,
        text,
      });
      await loadAll();
      closeEditBioModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update bio.');
    } finally {
      setSavingBioEdit(false);
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
      label: newProxyLabel.trim() || undefined,
      createdAt: Date.now(),
      ...assignPayload('proxy'),
    });
    setProxyRaw('');
    setProxyType('http');
    setNewProxyLabel('');
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

  function proxyLinkedAccounts(p: Proxy): string[] {
    return accounts
      .filter((a) => a.proxyId === p.id)
      .map((a) => a.identifier.replace(/^@/, ''));
  }

  const filteredProxies = useMemo(() => {
    const words = proxySearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return proxies;
    return proxies.filter((p) => {
      const linked = proxyLinkedAccounts(p);
      const haystack = [
        p.label,
        p.type,
        p.raw,
        p.host,
        p.port,
        p.username,
        p.password,
        p.allEmployees ? 'all employees' : '',
        ...assignedEmployees(p),
        ...linked,
        ...linked.map((h) => `@${h}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [proxies, proxySearch, accounts]);

  function proxyOptionLabel(p: Proxy) {
    const owners = p.allEmployees
      ? 'All employees'
      : assignedEmployees(p).join(', ');
    const linked = proxyLinkedAccounts(p);
    const acctNames = linked.length > 0 ? linked.map((h) => `@${h}`).join(', ') : undefined;
    const tag = p.label?.trim();
    const type = p.type || 'http';
    const endpoint =
      p.host && p.port ? `${p.host}:${p.port}` : p.raw || p.rotatingLink || p.id;
    const parts = [owners || undefined, tag || undefined, type, endpoint, acctNames].filter(Boolean);
    return parts.join(' · ');
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

  const pushableAccounts = useMemo(
    () =>
      savedAccounts.filter(
        (a) => !a.banned && a.handle.trim() && (a.password ?? '').trim(),
      ),
    [savedAccounts],
  );

  const activePostPublishAccounts = useMemo(
    () => (postCaptionModal ? postableAccountsForPost(postCaptionModal.post) : []),
    [postCaptionModal, pushableAccounts, employees, posts],
  );

  const activePostProxies = useMemo(
    () => (postCaptionModal ? proxiesForPost(postCaptionModal.post) : []),
    [postCaptionModal, proxies, employees, isAdmin, session],
  );

  const activePostAssignedOwners = useMemo(() => {
    if (!postCaptionModal) return null;
    return getAssignedOwnersForPost(postCaptionModal.post);
  }, [postCaptionModal, employees, posts]);

  function credentialsForSavedAccount(acct: BskySavedAccount): BskyCredentials {
    const handle = acct.handle.trim().replace(/^@/, '');
    const followAcct = accounts.find(
      (a) =>
        a.identifier.trim().replace(/^@/, '').toLowerCase() === handle.toLowerCase(),
    );
    return {
      identifier: acct.email?.trim() || handle,
      password: acct.password!.trim(),
      proxy: proxyConfigFor(followAcct?.proxyId),
    };
  }

  function accountSelectField(
    accountId: string,
    setAccountId: (id: string) => void,
    label = 'Bluesky account to update',
    hint = 'Choose a saved account from Accounts, then push a library item or upload below.',
  ) {
    return (
      <label className="cred-field">
        <span className="cred-field__label">{label}</span>
        <select
          className="cred-form__input"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">
            {pushableAccounts.length === 0
              ? 'No accounts with saved credentials'
              : 'Select account…'}
          </option>
          {pushableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.handle.replace(/^@/, '')}
              {a.owner ? ` · ${a.owner}` : ''}
            </option>
          ))}
        </select>
        <span className="cred-field__hint">{hint}</span>
      </label>
    );
  }

  function beginProfilePush(pushKey: string) {
    profilePushInFlightRef.current += 1;
    setProfilePushing(pushKey);
    setError(null);
    setSuccessMessage(null);
  }

  function endProfilePush(pushKey?: string) {
    profilePushInFlightRef.current = Math.max(0, profilePushInFlightRef.current - 1);
    if (profilePushInFlightRef.current === 0) {
      setProfilePushing(null);
      setProfilePushProgress(null);
    } else if (pushKey) {
      setProfilePushing((cur) => (cur === pushKey ? null : cur));
      setProfilePushProgress((cur) => (cur?.pushKey === pushKey ? null : cur));
    }
  }

  function setProfilePushStep(
    pushKey: string,
    kind: ProfilePushKind,
    done: number,
    total: number,
    currentHandle?: string,
  ) {
    setProfilePushProgress({ pushKey, done, total, currentHandle, kind });
  }

  async function handleDeleteBio(id: string) {
    const snapshot = bios;
    setBios((prev) => prev.filter((bio) => bio.id !== id));
    try {
      await deleteBio(id);
    } catch (err) {
      setBios(snapshot);
      setError(err instanceof Error ? err.message : 'Could not delete bio.');
    }
  }

  async function pushBioToSelectedAccounts(
    selectedIds: Set<string>,
    allAccounts: boolean,
    text: string,
    pushKey: string,
  ) {
    const targets = allAccounts
      ? pushableAccounts
      : pushableAccounts.filter((a) => selectedIds.has(a.id));
    if (targets.length === 0) {
      setError('Select at least one Bluesky account with saved credentials.');
      return;
    }
    if (!text.trim()) {
      setError('Enter bio text to push.');
      return;
    }
    if (activeProfilePushKeysRef.current.has(pushKey)) return;
    activeProfilePushKeysRef.current.add(pushKey);
    beginProfilePush(pushKey);
    const failures: string[] = [];
    let ok = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const acct = targets[i]!;
        const handle = acct.handle.replace(/^@/, '');
        setProfilePushStep(pushKey, 'bio', i, targets.length, handle);
        try {
          await pushProfileBio(credentialsForSavedAccount(acct), text.trim());
          ok += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Push failed';
          failures.push(`@${handle}: ${msg}`);
        }
        setProfilePushStep(pushKey, 'bio', i + 1, targets.length);
      }
      if (failures.length === 0) {
        setSuccessMessage(`Bio updated on ${ok} account${ok === 1 ? '' : 's'}.`);
      } else if (ok > 0) {
        setError(
          `Bio updated on ${ok} account${ok === 1 ? '' : 's'}, but failed on ${failures.length}: ${failures.join(' · ')}`,
        );
      } else {
        setError(failures.join(' · '));
      }
    } finally {
      activeProfilePushKeysRef.current.delete(pushKey);
      setProfilePushProgress((cur) => (cur?.pushKey === pushKey ? null : cur));
      endProfilePush(pushKey);
    }
  }

  function toggleBannerPushAccount(id: string) {
    setBannerPushAllAccounts(false);
    setBannerPushAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePicPushAccount(id: string) {
    setPicPushAllAccounts(false);
    setPicPushAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBioPushAccount(id: string) {
    setBioPushAllAccounts(false);
    setBioPushAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function pushImageToAccount(
    accountId: string,
    imageSource: string | File,
    field: 'banner' | 'avatar',
    pushKey: string,
  ) {
    const acct = pushableAccounts.find((a) => a.id === accountId);
    if (!acct) {
      setError('Select a Bluesky account with saved credentials.');
      return;
    }
    const handle = acct.handle.replace(/^@/, '');
    const kind: ProfilePushKind = field === 'banner' ? 'banner' : 'avatar';
    beginProfilePush(pushKey);
    setProfilePushStep(pushKey, kind, 0, 1, handle);
    try {
      const credentials = credentialsForSavedAccount(acct);
      if (typeof imageSource === 'string') {
        await pushProfileImageFromUrl(credentials, imageSource, field);
      } else {
        await pushProfileImageFromFile(credentials, imageSource, field);
      }
      setProfilePushStep(pushKey, kind, 1, 1);
      setSuccessMessage(
        `${field === 'banner' ? 'Banner' : 'Profile picture'} updated on Bluesky.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not update Bluesky profile image.',
      );
    } finally {
      setProfilePushProgress((cur) => (cur?.pushKey === pushKey ? null : cur));
      endProfilePush(pushKey);
    }
  }

  async function pushImageToSelectedAccounts(
    selectedIds: Set<string>,
    allAccounts: boolean,
    imageSource: string | File,
    field: 'banner' | 'avatar',
    pushKey: string,
  ) {
    const targets = allAccounts
      ? pushableAccounts
      : pushableAccounts.filter((a) => selectedIds.has(a.id));
    if (targets.length === 0) {
      setError('Select at least one Bluesky account with saved credentials.');
      return;
    }
    const kind: ProfilePushKind = field === 'banner' ? 'banner' : 'avatar';
    beginProfilePush(pushKey);
    const failures: string[] = [];
    let ok = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const acct = targets[i]!;
        const handle = acct.handle.replace(/^@/, '');
        setProfilePushStep(pushKey, kind, i, targets.length, handle);
        try {
          const credentials = credentialsForSavedAccount(acct);
          if (typeof imageSource === 'string') {
            await pushProfileImageFromUrl(credentials, imageSource, field);
          } else {
            await pushProfileImageFromFile(credentials, imageSource, field);
          }
          ok += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Push failed';
          failures.push(`@${handle}: ${msg}`);
        }
        setProfilePushStep(pushKey, kind, i + 1, targets.length);
      }
      const label = field === 'banner' ? 'Banner' : 'Profile picture';
      if (failures.length === 0) {
        setSuccessMessage(
          `${label} updated on ${ok} account${ok === 1 ? '' : 's'}.`,
        );
      } else if (ok > 0) {
        setError(
          `${label} updated on ${ok} account${ok === 1 ? '' : 's'}, but failed on ${failures.length}: ${failures.join(' · ')}`,
        );
      } else {
        setError(failures.join(' · '));
      }
    } finally {
      setProfilePushProgress((cur) => (cur?.pushKey === pushKey ? null : cur));
      endProfilePush(pushKey);
    }
  }

  async function runOne(account: BskyAccount) {
    cancelRef.current[account.id] = false;
    setActiveJobs((n) => n + 1);
    // Local snapshot mirrored to the DB so other sessions can see this run.
    const snap = {
      state: 'auth',
      text: 'Starting…',
      done: 0,
      total: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      live: '',
    };
    let lastWrite = 0;
    const writeRun = (active: boolean, force = false) => {
      const now = Date.now();
      if (!force && now - lastWrite < 1500) return;
      lastWrite = now;
      void upsertRun({
        accountId: account.id,
        identifier: account.identifier,
        owner: account.allEmployees ? 'all' : account.employees[0],
        state: snap.state,
        text: snap.text,
        done: snap.done,
        total: snap.total,
        success: snap.success,
        skipped: snap.skipped,
        failed: snap.failed,
        live: snap.live,
        active,
        updatedAt: now,
      }).catch(() => {});
    };
    setRunState((p) => ({
      ...p,
      [account.id]: { state: 'auth', text: 'Starting…', done: 0, total: 0, result: null, live: '' },
    }));
    writeRun(true, true);
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
          onStatus: (state, text) => {
            snap.state = state;
            snap.text = text;
            setRunState((p) => ({ ...p, [account.id]: { ...p[account.id], state, text } }));
            writeRun(state !== 'done' && state !== 'error');
          },
          onProgress: (d) => {
            if (d.status === 'followed') followBufferRef.current.push({ accountId: account.id });
            snap.done = d.done;
            snap.total = d.total;
            snap.success = d.success;
            snap.skipped = d.skipped;
            snap.failed = d.failed;
            if (d.status === 'followed') snap.live = `✓ followed @${d.label}`;
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
            writeRun(true);
          },
          shouldCancel: () => cancelRef.current[account.id],
        },
      );
      snap.state = res.ok ? (res.result.cancelled ? 'error' : 'done') : 'error';
      snap.text = res.ok ? (res.result.cancelled ? 'Stopped' : 'Done') : res.error ?? 'Error';
      snap.success = res.result.success;
      snap.skipped = res.result.skipped;
      snap.failed = res.result.failed;
      snap.total = res.result.total;
      setRunState((p) => ({
        ...p,
        [account.id]: {
          ...p[account.id],
          state: snap.state,
          text: snap.text,
          result: res.result,
        },
      }));
      writeRun(false, true);
      if (!res.ok && /taken\s*down|takedown/i.test(res.error ?? '')) {
        void autoBanByIdentifier(account.identifier);
      }
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

  function stopOne(id: string) {
    cancelRef.current[id] = true;
    setRunState((p) =>
      p[id] ? { ...p, [id]: { ...p[id], state: 'auth', text: 'Stopping…' } } : p,
    );
  }

  async function handleDeleteAccount(id: string) {
    await deleteBskyAccount(id);
    await loadAll();
  }

  function startEditAccount(acct: BskyAccount) {
    setEditingAccountId(acct.id);
    setEditDraft({ ...acct });
  }

  function cancelEditAccount() {
    setEditingAccountId(null);
    setEditDraft(null);
  }

  function updateDraft<K extends keyof BskyAccount>(key: K, value: BskyAccount[K]) {
    setEditDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  async function saveEditAccount(e: FormEvent) {
    e.preventDefault();
    if (!editDraft) return;
    if (!editDraft.identifier.trim() || !editDraft.password.trim() || !editDraft.target.trim()) return;
    try {
      await addBskyAccount({
        ...editDraft,
        identifier: editDraft.identifier.trim(),
        password: editDraft.password.trim(),
        target: editDraft.target.trim(),
        proxyId: editDraft.proxyId || undefined,
      });
      cancelEditAccount();
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update account.');
    }
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

  // Auto-flag a saved account as banned when its follow job reports the account
  // was taken down. Matches by handle or email so the dashboard updates live.
  async function autoBanByIdentifier(identifier: string) {
    const norm = identifier.trim().replace(/^@/, '').toLowerCase();
    if (!norm) return;
    const match = savedAccountsRef.current.find((a) => {
      const handle = (a.handle ?? '').trim().replace(/^@/, '').toLowerCase();
      const email = (a.email ?? '').trim().toLowerCase();
      return (handle && handle === norm) || (email && email === norm);
    });
    if (!match || match.banned) return;
    try {
      const banned = { ...match, banned: true };
      await addSavedAccount(banned);
      // Reflect immediately so the dashboard's banned count updates in real
      // time, then reconcile with storage.
      setSavedAccounts((prev) => prev.map((a) => (a.id === banned.id ? banned : a)));
      await loadAll();
    } catch {
      // Non-fatal: leave the account as-is if the write fails.
    }
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

  const navItems: { id: View; label: string; icon: ReactNode; adminOnly?: boolean }[] = [
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
      id: 'slaves',
      label: 'Slave Accounts',
      adminOnly: true,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8" cy="8" r="2.6" />
          <circle cx="16" cy="8" r="2.6" />
          <path d="M3 18c0-2.4 2.2-4 5-4s5 1.6 5 4" />
          <path d="M13 18c0-2.4 2.2-4 5-4 1.2 0 2.3.3 3 .9" />
        </svg>
      ),
    },
    {
      id: 'warmups',
      label: 'Warmups',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          <circle cx="12" cy="12" r="4" />
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
  ];

  const topbarTitle =
    view === 'dashboard'
      ? 'Dashboard'
      : view === 'accounts'
      ? 'Accounts'
      : view === 'slaves'
      ? 'Slave Accounts'
      : view === 'warmups'
      ? 'Warmups'
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
    profileField: 'banner' | 'avatar',
    accountId: string,
    setAccountId: (id: string) => void,
    directFile: File | null,
    setDirectFile: (f: File | null) => void,
    options?: {
      showCaption?: boolean;
      assignInForm?: boolean;
      onAssignItem?: (item: ImageAsset) => void;
      hideDirectUpload?: boolean;
      instantLibraryAdd?: boolean;
      onInstantAdd?: (file: File) => void;
      addInputRef?: React.RefObject<HTMLInputElement | null>;
      hideDownload?: boolean;
      mergeLibraryAdd?: boolean;
      useReelCellLayout?: boolean;
      libraryCellVariant?: 'banner' | 'profilepic';
      multiAccountSelect?: {
        selected: Set<string>;
        all: boolean;
        onToggle: (id: string) => void;
        onAllChange: (all: boolean) => void;
      };
    },
  ) => {
    const showCaption = options?.showCaption ?? true;
    const assignInForm = options?.assignInForm ?? true;
    const onAssignItem = options?.onAssignItem;
    const hideDirectUpload = options?.hideDirectUpload ?? false;
    const instantLibraryAdd = options?.instantLibraryAdd ?? false;
    const hideDownload = options?.hideDownload ?? false;
    const mergeLibraryAdd = options?.mergeLibraryAdd ?? false;
    const useReelCellLayout = options?.useReelCellLayout ?? false;
    const libraryCellVariant = options?.libraryCellVariant ?? 'banner';
    const libraryGridClass =
      libraryCellVariant === 'profilepic' ? 'profile-pic-library-grid' : 'banner-library-grid';
    const libraryCellClass =
      libraryCellVariant === 'profilepic' ? 'reel-cell reel-cell--profilepic' : 'reel-cell reel-cell--banner';
    const multiAccountSelect = options?.multiAccountSelect;

    const canPush =
      multiAccountSelect != null
        ? multiAccountSelect.all || multiAccountSelect.selected.size > 0
        : Boolean(accountId);

    function handlePush(item: ImageAsset, source: string | File) {
      if (multiAccountSelect) {
        void pushImageToSelectedAccounts(
          multiAccountSelect.selected,
          multiAccountSelect.all,
          source,
          profileField,
          item.id,
        );
      } else {
        void pushImageToAccount(accountId, source, profileField, item.id);
      }
    }

    return (
    <>
      <section className="panel">
        <h2>Update on Bluesky</h2>
        {hideDirectUpload ? (
          <>
            <div className="bio-form">
              {multiAccountSelect ? (
                <SavedAccountMultiPicker
                  accounts={pushableAccounts}
                  selected={multiAccountSelect.selected}
                  all={multiAccountSelect.all}
                  onToggle={multiAccountSelect.onToggle}
                  onAllChange={multiAccountSelect.onAllChange}
                  hint="Choose saved accounts from Accounts, then push a library item below."
                />
              ) : (
                accountSelectField(
                  accountId,
                  setAccountId,
                  undefined,
                  'Choose a saved account from Accounts, then push a library item below.',
                )
              )}
            </div>
            {profilePushProgress &&
              (profilePushProgress.kind === 'banner' || profilePushProgress.kind === 'avatar') && (
              <div className="profile-push-progress--panel">
                <ProfilePushProgressBar progress={profilePushProgress} />
              </div>
            )}
          </>
        ) : (
        <form
          className="bio-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!directFile) return;
            void pushImageToAccount(accountId, directFile, profileField, `direct-${key}`);
          }}
        >
          {accountSelectField(accountId, setAccountId)}
          <label className="content-upload">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setDirectFile(e.target.files?.[0] ?? null)}
            />
            <span className="content-upload__hint">
              {directFile ? directFile.name : `Choose a new ${title.toLowerCase()} image`}
            </span>
          </label>
          <button
            type="submit"
            disabled={profilePushing === `direct-${key}` || !accountId || !directFile}
          >
            {profilePushing === `direct-${key}` ? 'Updating…' : `Update ${title.toLowerCase()}`}
          </button>
          {profilePushProgress?.pushKey === `direct-${key}` && (
            <div className="profile-push-progress--panel">
              <ProfilePushProgressBar progress={profilePushProgress} />
            </div>
          )}
        </form>
        )}
      </section>

      {isAdmin && !mergeLibraryAdd && (
        <section className="panel">
          <div className="panel-head">
            <h2>Add {title.toLowerCase()} to library</h2>
            {instantLibraryAdd ? (
              <>
                <button
                  type="button"
                  className="panel-add-toggle"
                  disabled={uploading}
                  onClick={() => options?.addInputRef?.current?.click()}
                >
                  {uploading ? 'Uploading…' : 'ADD'}
                </button>
                <input
                  ref={options?.addInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    e.target.value = '';
                    if (picked) options?.onInstantAdd?.(picked);
                  }}
                />
              </>
            ) : (
            <button
              type="button"
              className={`panel-add-toggle ${openForms.has(key) ? 'panel-add-toggle--open' : ''}`}
              onClick={() => toggleForm(key)}
            >
              {openForms.has(key) ? 'Hide' : 'Add'}
            </button>
            )}
          </div>
          {!instantLibraryAdd && openForms.has(key) && (
            <form className="bio-form" onSubmit={submit}>
              <label className="content-upload">
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <span className="content-upload__hint">{file ? file.name : `Choose a ${title.toLowerCase()} image`}</span>
              </label>
              {showCaption && (
                <input
                  className="cred-form__input"
                  placeholder="Caption (optional)"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              )}
              {assignInForm && (
                <AssignmentPicker
                  employees={employees}
                  selected={getAssign(key).set}
                  all={getAssign(key).all}
                  onToggle={(u) => toggleAssign(key, u)}
                  onAllChange={(a) => setAssignAll(key, a)}
                />
              )}
              <button type="submit" disabled={uploading || !file || (assignInForm && !assignValid(key))}>
                {uploading ? 'Uploading…' : `Add ${title.toLowerCase()}`}
              </button>
            </form>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>{isAdmin ? `${title} library (${items.length})` : `Your ${title.toLowerCase()}s (${items.length})`}</h2>
          {instantLibraryAdd && mergeLibraryAdd && (
            <>
              <button
                type="button"
                className="panel-add-toggle"
                disabled={uploading}
                onClick={() => options?.addInputRef?.current?.click()}
              >
                {uploading ? 'Uploading…' : 'ADD'}
              </button>
              <input
                ref={options?.addInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  e.target.value = '';
                  if (picked) options?.onInstantAdd?.(picked);
                }}
              />
            </>
          )}
        </div>
        {items.length === 0 ? (
          <p className="empty-note">Nothing here yet.</p>
        ) : useReelCellLayout ? (
          <div className={libraryGridClass}>
            {items.map((item) => (
              <div key={item.id} className={libraryCellClass}>
                <img className="reel-cell__media" src={item.url} alt={item.caption ?? ''} loading="lazy" />
                <div className="reel-cell__overlay">
                  {isAdmin && onAssignItem && (
                    <button
                      type="button"
                      className="reel-cell__btn reel-cell__btn--wide"
                      onClick={() => onAssignItem(item)}
                      title="Assign to employees"
                    >
                      Assign
                    </button>
                  )}
                  {ownsLibraryItem(item) && (
                    <button
                      type="button"
                      className="reel-cell__btn reel-cell__btn--danger"
                      onClick={() => onDelete(item.id)}
                      title="Delete"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {profilePushing === item.id && profilePushProgress?.pushKey === item.id ? (
                  <div className="reel-cell__progress">
                    <ProfilePushProgressBar progress={profilePushProgress} />
                  </div>
                ) : (
                <div className="reel-cell__footer">
                  <button
                    type="button"
                    className="reel-cell__action reel-cell__action--primary"
                    disabled={profilePushing === item.id || !canPush}
                    onClick={() => handlePush(item, item.url)}
                  >
                    {profilePushing === item.id ? 'Pushing…' : 'Push to Bluesky'}
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="content-grid">
            {items.map((item) => (
              <div key={item.id} className="content-tile">
                <img className="bsky-image" src={item.url} alt={item.caption ?? ''} loading="lazy" />
                {item.caption && <p className="content-tile__caption">{item.caption}</p>}
                <div className="content-tile__meta">
                  <div className="content-tile__assign">{renderAssignTags(item)}</div>
                  <div className="content-tile__actions">
                    <button
                      type="button"
                      className="content-tile__download"
                      disabled={profilePushing === item.id || !canPush}
                      onClick={() => handlePush(item, item.url)}
                    >
                      {profilePushing === item.id ? 'Pushing…' : 'Push to Bluesky'}
                    </button>
                    {!hideDownload && (
                    <a className="content-tile__download" href={item.url} download target="_blank" rel="noreferrer">
                      ↓ Download
                    </a>
                    )}
                    {isAdmin && onAssignItem && (
                      <button
                        type="button"
                        className="content-tile__download"
                        onClick={() => onAssignItem(item)}
                        title="Assign to employees"
                      >
                        Assign
                      </button>
                    )}
                    {ownsLibraryItem(item) && (
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
  };

  const bioSection = (items: Bio[]) => {
    const canPushBio = bioPushAllAccounts || bioPushAccountIds.size > 0;

    const renderBioLibrary = (libraryItems: Bio[]) => (
      <div className="bio-library-grid">
        {libraryItems.map((item) => (
          <div key={item.id} className="bio-cell">
            <div className="bio-cell__body">
              <p className="bio-cell__text">{item.text}</p>
            </div>
            {isAdmin && (
              <div className="bio-cell__overlay">
                <button
                  type="button"
                  className="reel-cell__btn reel-cell__btn--wide"
                  onClick={() => openAssignBioModal(item)}
                  title="Assign to employees"
                >
                  Assign
                </button>
                <button
                  type="button"
                  className="reel-cell__btn"
                  onClick={() => openEditBioModal(item)}
                  title="Edit bio"
                  aria-label="Edit bio"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="reel-cell__btn reel-cell__btn--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteBio(item.id);
                  }}
                  title="Delete"
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            )}
            {!isAdmin && ownsLibraryItem(item) && (
              <div className="bio-cell__overlay">
                <button
                  type="button"
                  className="reel-cell__btn"
                  onClick={() => openEditBioModal(item)}
                  title="Edit bio"
                  aria-label="Edit bio"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="reel-cell__btn reel-cell__btn--danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteBio(item.id);
                  }}
                  title="Delete"
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            )}
            {profilePushing === item.id && profilePushProgress?.pushKey === item.id ? (
              <div className="bio-cell__progress">
                <ProfilePushProgressBar progress={profilePushProgress} />
              </div>
            ) : (
            <div className="bio-cell__footer">
              <button
                type="button"
                className="reel-cell__action reel-cell__action--primary"
                disabled={profilePushing === item.id || !canPushBio}
                onClick={() =>
                  void pushBioToSelectedAccounts(
                    bioPushAccountIds,
                    bioPushAllAccounts,
                    item.text,
                    item.id,
                  )
                }
              >
                {profilePushing === item.id ? 'Pushing…' : 'Push to Bluesky'}
              </button>
              <CopyButton value={item.text} title="Copy bio" />
            </div>
            )}
          </div>
        ))}
      </div>
    );

    return (
    <>
      <section className="panel">
        <h2>Update on Bluesky</h2>
        <div className="bio-form">
          <SavedAccountMultiPicker
            accounts={pushableAccounts}
            selected={bioPushAccountIds}
            all={bioPushAllAccounts}
            onToggle={toggleBioPushAccount}
            onAllChange={setBioPushAllAccounts}
            hint="Choose saved accounts from Accounts, then push a library item below."
          />
        </div>
        {profilePushProgress?.kind === 'bio' && (
          <div className="profile-push-progress--panel">
            <ProfilePushProgressBar progress={profilePushProgress} />
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{isAdmin ? `Bio library (${items.length})` : `Your bios (${items.length})`}</h2>
          <button
            type="button"
            className="panel-add-toggle"
            onClick={openAddBioModal}
          >
            ADD
          </button>
        </div>
        {items.length === 0 ? (
          <p className="empty-note">
            {isAdmin
              ? 'Nothing here yet. Add a bio, assign employees, then push to Bluesky.'
              : 'Nothing here yet. Add a bio, then push it to your accounts.'}
          </p>
        ) : (
          renderBioLibrary(items)
        )}
      </section>
    </>
    );
  };

  const bannedCount = savedAccounts.filter((a) => a.banned).length;

  // Only count follows belonging to accounts the current user can see.
  const visibleAccountIds = useMemo(() => new Set(accounts.map((a) => a.id)), [accounts]);
  const visibleFollowEvents = useMemo(
    () => followEvents.filter((e) => visibleAccountIds.has(e.accountId)),
    [followEvents, visibleAccountIds],
  );
  const totalFollows = useMemo(
    () => visibleFollowEvents.reduce((sum, e) => sum + Number(e.count || 0), 0),
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
      accounts.filter((a) => Number(a.createdAt) >= todayStart.getTime()).map((a) => a.id),
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
          const at = Number(ev.capturedAt);
          if (at >= start && at <= end) {
            if (newAcctIds.has(ev.accountId)) newValue += Number(ev.count || 0);
            else oldValue += Number(ev.count || 0);
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
  const selectedFollowBar =
    selectedFollowDay != null ? followBars.find((b) => b.day === selectedFollowDay) ?? null : null;
  const followMonthName = followMonthLabel.split(' ')[0];

  // Combine this session's runs with runs reported by other sessions (other
  // admins / employees) so the active count + indicator reflect every device.
  const nowTs = Date.now();
  const localActiveIds = Object.keys(runState).filter(
    (id) => runState[id].state !== 'done' && runState[id].state !== 'error',
  );
  const remoteActiveIds = Object.values(remoteRuns)
    .filter(
      (r) =>
        r.active &&
        nowTs - r.updatedAt < RUN_STALE_MS &&
        visibleAccountIds.has(r.accountId) &&
        !localActiveIds.includes(r.accountId),
    )
    .map((r) => r.accountId);
  const activeAccountIds = new Set([...localActiveIds, ...remoteActiveIds]);
  const totalActiveCount = activeAccountIds.size;
  let liveFollowedTotal = 0;
  for (const id of activeAccountIds) {
    const local = runState[id];
    if (local?.result) liveFollowedTotal += local.result.success;
    else liveFollowedTotal += remoteRuns[id]?.success ?? 0;
  }

  const localWarmupActiveKeys = warmupRunning
    ? Object.entries(warmupCardProgress)
        .filter(
          ([key, card]) =>
            warmupExecutorKeysRef.current.has(key) &&
            (card.status === 'waiting' || card.status === 'running'),
        )
        .map(([key]) => key)
    : [];
  const remoteWarmupActiveKeys = Object.values(remoteWarmupRuns)
    .filter(
      (r) =>
        r.active &&
        (r.status === 'waiting' || r.status === 'running') &&
        nowTs - r.updatedAt < RUN_STALE_MS &&
        visibleWarmupKeys.has(r.accountKey) &&
        (!warmupRunning || !warmupExecutorKeysRef.current.has(r.accountKey)),
    )
    .map((r) => r.accountKey);
  const warmupActiveKeySet = new Set([...localWarmupActiveKeys, ...remoteWarmupActiveKeys]);
  const warmupActiveCount = warmupActiveKeySet.size;
  let warmupRunningCount = 0;
  let warmupDoneInSession = 0;
  for (const key of warmupActiveKeySet) {
    const card =
      warmupCardProgress[key] ??
      (remoteWarmupRuns[key] ? warmupCardFromRun(remoteWarmupRuns[key]) : undefined);
    if (card?.status === 'running') warmupRunningCount += 1;
    if (card?.status === 'done') warmupDoneInSession += 1;
  }
  const warmupRemoteOnly = remoteWarmupActiveKeys.length > 0 && !warmupRunning;

  const dashboardCards = [
    { label: 'Employees', value: employees.length, show: isAdmin },
    { label: 'Accounts', value: savedAccounts.length, show: true },
    { label: 'Target Profiles', value: targets.length, show: true },
    { label: 'Follows', value: totalFollows, show: true },
    { label: 'Banned Accounts', value: bannedCount, show: true },
  ].filter((c) => c.show);

  const hasCachedData =
    accounts.length > 0 ||
    savedAccounts.length > 0 ||
    followEvents.length > 0 ||
    employees.length > 0 ||
    banners.length > 0;
  const showInitialLoading = loading && !hasCachedData;

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
          {navItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => (
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
            {totalActiveCount > 0 && (
              <div className="follow-running" role="status">
                <span className="follow-running__pulse" aria-hidden />
                <span className="follow-running__text">
                  Following · {totalActiveCount} {totalActiveCount === 1 ? 'account' : 'accounts'} ·{' '}
                  {formatCount(liveFollowedTotal)} followed
                  {remoteActiveIds.length > 0 && activeJobs === 0 ? ' (other devices)' : ''}
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
                {activeJobs > 0 && (
                  <button type="button" className="btn btn--danger" onClick={stopAll}>
                    Stop
                  </button>
                )}
              </div>
            )}
            {warmupActiveCount > 0 && (
              <div className="follow-running warmup-running" role="status">
                <span className="follow-running__pulse" aria-hidden />
                <span className="follow-running__text">
                  Warm-up · {warmupActiveCount}{' '}
                  {warmupActiveCount === 1 ? 'account' : 'accounts'}
                  {warmupRunningCount > 0
                    ? ` · ${warmupRunningCount} running`
                    : warmupDoneInSession > 0
                      ? ` · ${warmupDoneInSession} done`
                      : ''}
                  {warmupRemoteOnly ? ' (other devices)' : ''}
                </span>
                {view !== 'warmups' && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setSelectedEmployee(null);
                      setView('warmups');
                    }}
                  >
                    View
                  </button>
                )}
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

        {successMessage && (
          <div className="banner banner--success">
            <span>{successMessage}</span>
            <button
              type="button"
              className="banner__close"
              onClick={() => setSuccessMessage(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {showInitialLoading && view === 'dashboard' ? (
          <section className="panel">
            <div className="loading-block">
              <span className="spinner" aria-hidden />
              <span>Loading…</span>
            </div>
          </section>
        ) : (
          <>
            {view === 'dashboard' && (refreshing || loading) && hasCachedData && (
              <div className="refresh-progress refresh-progress--inline" role="status">
                <span className="spinner spinner--sm" aria-hidden />
                <span className="refresh-progress__label">Refreshing dashboard…</span>
              </div>
            )}
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
                    {selectedFollowBar ? (
                      <>
                        <strong>{formatCount(selectedFollowBar.newValue + selectedFollowBar.oldValue)}</strong>
                        <span className="delta">
                          follows on {followMonthName} {selectedFollowBar.day} · new accounts{' '}
                          {formatCount(selectedFollowBar.newValue)} · old accounts{' '}
                          {formatCount(selectedFollowBar.oldValue)}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>{formatCount(monthFollowTotal)}</strong>
                        <span className="delta">new follows this month{activeJobs > 0 ? ' · live' : ''}</span>
                      </>
                    )}
                  </div>

                  <BskyFollowChart
                    bars={followBars}
                    selectedDay={selectedFollowDay}
                    onSelectDay={(day) =>
                      setSelectedFollowDay((cur) => (cur === day ? null : day))
                    }
                  />
                </div>

                <p className="empty-note">
                  Live follow totals update every second (including follows run by other employees).
                  Click a day to see its breakdown — bars split each day's follows by accounts added
                  today (new) versus earlier (old).
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

            {view === 'slaves' && isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Slave Accounts ({slaveAccounts.length})</h2>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowAddSlave((v) => !v)}
                  >
                    {showAddSlave ? 'Cancel' : '+ Add slave'}
                  </button>
                </div>

                <p className="empty-note">
                  These accounts are used only for mass liking and reposting from the Post
                  engagement tab. They are kept separate from your normal accounts and never
                  appear in account dropdowns.
                </p>

                {slaveAccounts.length > 0 && (
                  <div className="slave-bulkbar">
                    <label className="slave-bulkbar__select">
                      <input
                        type="checkbox"
                        checked={selectedSlaveIds.size === slaveAccounts.length}
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              selectedSlaveIds.size > 0 &&
                              selectedSlaveIds.size < slaveAccounts.length;
                        }}
                        onChange={toggleSelectAllSlaves}
                        disabled={deletingSlaves}
                      />
                      <span>
                        {selectedSlaveIds.size > 0
                          ? `${selectedSlaveIds.size} selected`
                          : 'Select all'}
                      </span>
                    </label>
                    <div className="slave-bulkbar__actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={deletingSlaves || selectedSlaveIds.size === 0}
                        onClick={() => void handleDeleteSelectedSlaves()}
                      >
                        {deletingSlaves ? 'Deleting…' : `Delete selected (${selectedSlaveIds.size})`}
                      </button>
                      <button
                        type="button"
                        className="license-row__delete slave-bulkbar__delete-all"
                        disabled={deletingSlaves}
                        onClick={() => void handleDeleteAllSlaves()}
                      >
                        Delete all
                      </button>
                    </div>
                  </div>
                )}

                {showAddSlave && (
                  <form className="bio-form" onSubmit={handleAddSlaveAccount}>
                    <input
                      className="cred-form__input"
                      placeholder="Handle (e.g. name.bsky.social)"
                      value={newSlaveHandle}
                      onChange={(e) => setNewSlaveHandle(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <input
                      className="cred-form__input"
                      type="text"
                      placeholder="Password / app password"
                      value={newSlavePassword}
                      onChange={(e) => setNewSlavePassword(e.target.value)}
                      autoComplete="off"
                    />
                    <ProxyPicker
                      proxies={proxies}
                      value={newSlaveProxyId}
                      onChange={setNewSlaveProxyId}
                      label="Proxy (optional)"
                      optionLabel={proxyOptionLabel}
                    />
                    <button
                      type="submit"
                      disabled={!newSlaveHandle.trim() || !newSlavePassword.trim() || savingSlave}
                    >
                      {savingSlave ? 'Verifying credentials…' : 'Add slave account'}
                    </button>
                    {savingSlave && (
                      <div className="publish-progress publish-progress--indeterminate">
                        <div className="publish-progress__track">
                          <div className="publish-progress__fill" />
                        </div>
                        <span className="publish-progress__label">
                          Verifying @{newSlaveHandle.trim().replace(/^@/, '')} with Bluesky…
                        </span>
                      </div>
                    )}
                  </form>
                )}

                {slaveAccounts.length === 0 ? (
                  <p className="empty-note">
                    No slave accounts yet. Add accounts with their handle and password to build
                    your mass like/repost pool.
                  </p>
                ) : (
                  <div className="proxy-list">
                    {slaveAccounts.map((acct) => (
                      <div
                        key={acct.id}
                        className={`proxy-row${selectedSlaveIds.has(acct.id) ? ' proxy-row--selected' : ''}`}
                      >
                        <label className="slave-row__check" title="Select">
                          <input
                            type="checkbox"
                            checked={selectedSlaveIds.has(acct.id)}
                            onChange={() => toggleSlaveSelected(acct.id)}
                            disabled={deletingSlaves}
                          />
                        </label>
                        <div className="proxy-row__body">
                          <div className="proxy-row__top">
                            <strong>@{acct.handle}</strong>
                          </div>
                          <div className="proxy-row__fields">
                            <CopyField label="Handle" value={acct.handle} />
                            <CopyField label="Password" value={acct.password} />
                          </div>
                          <div className="slave-row__proxy">
                            <ProxyPicker
                              proxies={proxies}
                              value={acct.proxyId ?? ''}
                              onChange={(id) => void handleUpdateSlaveProxy(acct, id)}
                              label="Proxy"
                              optionLabel={proxyOptionLabel}
                            />
                          </div>
                        </div>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="license-row__delete"
                            onClick={() => handleDeleteSlaveAccount(acct.id)}
                            disabled={deletingSlaves}
                            title="Delete slave account"
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

            {view === 'warmups' && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Warmups</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    {warmupTab === 'slave' && activeSlaveWarmupCount > 0 && (
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={stopAllSlaveWarmups}
                      >
                        Stop all ({activeSlaveWarmupCount})
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={startableWarmupRows.length === 0}
                      onClick={() => void startWarmup()}
                    >
                      {warmupRunning
                        ? `Running… · ${startableWarmupRows.length} ready`
                        : `Start warm-up (${startableWarmupRows.length})`}
                    </button>
                  </div>
                </div>

                <p className="empty-note">
                  Each selected account runs a ~5 minute warm-up: feed scrolling, likes, thread
                  reads, profile browsing, and short replies — simulating natural Bluesky activity.
                </p>

                <div className="platform-switch warmup-tabs">
                  <button
                    type="button"
                    className={
                      warmupTab === 'follow'
                        ? 'platform-switch__btn platform-switch__btn--active'
                        : 'platform-switch__btn'
                    }
                    onClick={() => setWarmupTab('follow')}
                  >
                    Follow accounts
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      className={
                        warmupTab === 'slave'
                          ? 'platform-switch__btn platform-switch__btn--active'
                          : 'platform-switch__btn'
                      }
                      onClick={() => setWarmupTab('slave')}
                    >
                      Slave accounts
                    </button>
                  )}
                </div>

                {warmupTab === 'follow' && (
                  <>
                    {isAdmin && (
                      <label className="cred-field warmup-employee-filter">
                        <span className="cred-field__label">Employee</span>
                        <select
                          className="cred-form__input"
                          value={warmupFollowEmployee}
                          onChange={(e) => setWarmupFollowEmployee(e.target.value)}
                          disabled={employees.length === 0}
                        >
                          {employees.length === 0 ? (
                            <option value="">No employees</option>
                          ) : (
                            employees.map((emp) => (
                              <option key={emp.username} value={emp.username}>
                                {emp.username} ({employeeCounts[emp.username] ?? 0} accounts)
                              </option>
                            ))
                          )}
                        </select>
                        <span className="cred-field__hint">
                          Shows follow accounts assigned to this employee.
                        </span>
                      </label>
                    )}

                    {followWarmupFiltered.length === 0 ? (
                      <p className="empty-note">
                        {isAdmin
                          ? 'No follow accounts for this employee. Add accounts on the Follow page and assign them.'
                          : 'No follow accounts yet. Add accounts on the Follow page.'}
                      </p>
                    ) : (
                      <>
                        <WarmupAccountMultiPicker
                          accounts={followWarmupPickerAccounts}
                          selected={selectedFollowWarmupIds}
                          all={selectAllFollowWarmups}
                          onToggle={toggleFollowWarmupSelected}
                          onAllChange={setSelectAllFollowWarmups}
                          label="Follow accounts to warm up"
                          hint="Multi-select or choose Select all, then start warm-up."
                        />
                        {renderWarmupBubbleCards(displayWarmupRowsForTab)}
                      </>
                    )}
                  </>
                )}

                {warmupTab === 'slave' && isAdmin && (
                  <>
                    <p className="empty-note">
                      Slave accounts use their assigned proxy when set.
                    </p>
                    {slaveWarmupPool.length === 0 ? (
                      <p className="empty-note">
                        No slave accounts yet. Add accounts on the Slave Accounts page.
                      </p>
                    ) : (
                      <>
                        <WarmupAccountMultiPicker
                          accounts={slaveWarmupPickerAccounts}
                          selected={selectedSlaveWarmupIds}
                          all={selectAllSlaveWarmups}
                          onToggle={toggleSlaveWarmupSelected}
                          onAllChange={setSelectAllSlaveWarmups}
                          label="Slave accounts to warm up"
                          hint="Multi-select or choose Select all, then start warm-up."
                        />
                        {renderWarmupBubbleCards(displayWarmupRowsForTab)}
                      </>
                    )}
                  </>
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
              imageSection(
                'Banner',
                banners,
                null,
                () => {},
                '',
                () => {},
                async () => {},
                deleteBanner,
                'banner',
                'banner',
                '',
                () => {},
                null,
                () => {},
                {
                  showCaption: false,
                  assignInForm: false,
                  onAssignItem: openAssignBannerModal,
                  hideDirectUpload: true,
                  instantLibraryAdd: true,
                  onInstantAdd: uploadBanner,
                  addInputRef: bannerAddInputRef,
                  hideDownload: true,
                  mergeLibraryAdd: true,
                  useReelCellLayout: true,
                  multiAccountSelect: {
                    selected: bannerPushAccountIds,
                    all: bannerPushAllAccounts,
                    onToggle: toggleBannerPushAccount,
                    onAllChange: setBannerPushAllAccounts,
                  },
                },
              )}

            {view === 'profilepic' &&
              imageSection(
                'Profile Picture',
                profilePics,
                picFile,
                setPicFile,
                picCaption,
                setPicCaption,
                submitPic,
                deleteProfilePic,
                'pic',
                'avatar',
                picPushAccountId,
                setPicPushAccountId,
                directPicFile,
                setDirectPicFile,
                {
                  hideDirectUpload: true,
                  assignInForm: false,
                  onAssignItem: openAssignProfilePicModal,
                  instantLibraryAdd: true,
                  onInstantAdd: (file) => setProfilePicCropFile(file),
                  addInputRef: picAddInputRef,
                  mergeLibraryAdd: true,
                  useReelCellLayout: true,
                  libraryCellVariant: 'profilepic',
                  hideDownload: true,
                  multiAccountSelect: {
                    selected: picPushAccountIds,
                    all: picPushAllAccounts,
                    onToggle: togglePicPushAccount,
                    onAllChange: setPicPushAllAccounts,
                  },
                },
              )}

            {view === 'bio' && bioSection(bios)}

            {view === 'post' && (
              <>
                <div className="toggle-group content-tabs">
                  <button
                    type="button"
                    className={`toggle ${postMediaTab === 'image' ? 'toggle--active' : ''}`}
                    onClick={() => {
                      setPostMediaTab('image');
                      if (postFileInputRef.current) postFileInputRef.current.value = '';
                    }}
                  >
                    Image
                  </button>
                  <button
                    type="button"
                    className={`toggle ${postMediaTab === 'video' ? 'toggle--active' : ''}`}
                    onClick={() => {
                      setPostMediaTab('video');
                      if (postFileInputRef.current) postFileInputRef.current.value = '';
                    }}
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    className={`toggle ${postMediaTab === 'engagement' ? 'toggle--active' : ''}`}
                    onClick={() => setPostMediaTab('engagement')}
                  >
                    Engagement
                  </button>
                </div>

                {postMediaTab !== 'engagement' && (
                  <input
                    ref={postFileInputRef}
                    type="file"
                    accept={postMediaTab === 'video' ? 'video/mp4' : 'image/*'}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void uploadPostMedia(file);
                    }}
                  />
                )}

                {postMediaTab !== 'engagement' && (
                  <section className="panel">
                      <div className="panel-head">
                        <h2>
                          {isAdmin
                            ? `${postMediaTab === 'image' ? 'Images' : 'Videos'} (${displayedPosts.length})`
                            : `Your ${postMediaTab === 'image' ? 'images' : 'videos'} (${displayedPosts.length})`}
                        </h2>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => postFileInputRef.current?.click()}
                          disabled={uploading}
                        >
                          {uploading
                            ? 'Uploading…'
                            : postMediaTab === 'image'
                              ? 'Add image'
                              : 'Add video'}
                        </button>
                      </div>
                      {uploading && (
                        <div className="publish-progress publish-progress--indeterminate">
                          <div className="publish-progress__track">
                            <div className="publish-progress__fill" />
                          </div>
                          <span className="publish-progress__label">
                            Uploading {postMediaTab === 'image' ? 'image' : 'video'}…
                          </span>
                        </div>
                      )}
                      {displayedPosts.length === 0 ? (
                        <p className="empty-note">
                          {isAdmin
                            ? `No ${postMediaTab === 'image' ? 'images' : 'videos'} yet. Upload one, assign an employee, then post to Bluesky.`
                            : `No ${postMediaTab === 'image' ? 'images' : 'videos'} yet. Upload one, then post to your Bluesky accounts.`}
                        </p>
                      ) : (
                        <div className="reels-grid">
                          {displayedPosts.map((post) => {
                            const hasPublished = (post.publishes ?? []).some((p) => p.uri && !p.error);
                            const postable = postableAccountsForPost(post);
                            const isPublishing = postPublishingId === post.id;
                            return (
                              <div key={post.id} className="reel-cell">
                                {post.mediaType === 'video' && post.videoUrl ? (
                                  <HoverLoopVideo
                                    className="reel-cell__media"
                                    src={post.videoUrl}
                                  />
                                ) : post.imageUrl ? (
                                  <img
                                    className="reel-cell__media"
                                    src={post.imageUrl}
                                    alt={post.text || ''}
                                    loading="lazy"
                                  />
                                ) : null}
                                <div className="reel-cell__overlay">
                                  {hasPublished && (
                                    <button
                                      type="button"
                                      className="reel-cell__btn reel-cell__btn--wide"
                                      onClick={() => setPostMediaTab('engagement')}
                                      title="View engagement"
                                    >
                                      Engagement
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="reel-cell__btn reel-cell__btn--wide"
                                    onClick={() => downloadPost(post)}
                                    title="Download"
                                  >
                                    Download
                                  </button>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      className="reel-cell__btn reel-cell__btn--wide"
                                      onClick={() => openAssignPostModal(post)}
                                      title="Assign to employees"
                                    >
                                      Assign
                                    </button>
                                  )}
                                  {ownsLibraryItem(post) && (
                                    <button
                                      type="button"
                                      className="reel-cell__btn reel-cell__btn--danger"
                                      onClick={() => void deletePost(post.id).then(loadAll)}
                                      title="Delete"
                                      aria-label="Delete"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                                {isPublishing && postPublishProgress?.pushKey === post.id ? (
                                  <div className="reel-cell__progress">
                                    <ProfilePushProgressBar progress={postPublishProgress} />
                                  </div>
                                ) : (
                                  <div className="reel-cell__footer">
                                    <button
                                      type="button"
                                      className="reel-cell__action reel-cell__action--primary reel-cell__action--publish"
                                      disabled={isPublishing || postable.length === 0}
                                      onClick={() => openPostPublishModal(post)}
                                    >
                                      Publish
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                )}

                {postMediaTab === 'engagement' && (
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Engagement ({engagementPosts.filter((p) => (p.publishes ?? []).some((pub) => pub.uri && !pub.error)).length})</h2>
                      <button
                        type="button"
                        className="panel-add-toggle"
                        disabled={refreshingPostStats !== null}
                        onClick={() => {
                          const published = engagementPosts.filter((p) =>
                            (p.publishes ?? []).some((pub) => pub.uri && !pub.error),
                          );
                          if (published.length === 0) return;
                          void (async () => {
                            for (const post of published) {
                              await refreshPostEngagement(post);
                            }
                          })();
                        }}
                      >
                        {refreshingPostStats ? 'Refreshing…' : 'Refresh all'}
                      </button>
                    </div>
                    {engagementPosts.length === 0 ? (
                      <p className="empty-note">No published posts yet. Post an image or video first.</p>
                    ) : (
                      <div className="post-engagement-list">
                        {engagementPosts.map((post) => {
                          const successful = (post.publishes ?? []).filter((p) => p.uri && !p.error);
                          const totalLikes = successful.reduce((sum, p) => sum + (p.likeCount ?? 0), 0);
                          const totalReplies = successful.reduce((sum, p) => sum + (p.replyCount ?? 0), 0);
                          const totalReposts = successful.reduce((sum, p) => sum + (p.repostCount ?? 0), 0);
                          const slaveLikeCount = successful.reduce((s, p) => s + (p.slaveLikes?.length ?? 0), 0);
                          const slaveRepostCount = successful.reduce((s, p) => s + (p.slaveReposts?.length ?? 0), 0);
                          const inputs = engagementInput(post.id);
                          const massBusy = massActionStatus[post.id];
                          return (
                            <div key={post.id} className="post-engagement-card">
                              <div className="post-engagement-card__media">
                                {post.mediaType === 'video' && post.videoUrl ? (
                                  <HoverLoopVideo
                                    className="bsky-video"
                                    src={post.videoUrl}
                                  />
                                ) : post.imageUrl ? (
                                  <img className="bsky-image bsky-image--post" src={post.imageUrl} alt="" loading="lazy" />
                                ) : null}
                              </div>
                              <div className="post-engagement-card__body">
                                {post.text && <p className="bio-row__text">{post.text}</p>}
                                <div className="post-engagement-card__totals">
                                  <span className="post-engagement-stat">♥ {formatCount(totalLikes)}</span>
                                  <span className="post-engagement-stat">💬 {formatCount(totalReplies)}</span>
                                  <span className="post-engagement-stat">↻ {formatCount(totalReposts)}</span>
                                </div>
                                <div className="post-engagement-card__accounts">
                                  {(post.publishes ?? []).map((pub) => (
                                    <div key={`${post.id}-${pub.accountId}`} className="post-engagement-row">
                                      <div className="post-engagement-row__main">
                                        <span className="post-engagement-row__handle">@{pub.handle.replace(/^@/, '')}</span>
                                        {pub.error ? (
                                          <span className="post-engagement-row__error">{pub.error}</span>
                                        ) : (
                                          <span className="post-engagement-row__stats">
                                            ♥ {pub.likeCount ?? '—'} · 💬 {pub.replyCount ?? '—'} · ↻ {pub.repostCount ?? '—'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {isAdmin && (
                                  <div className="mass-engage">
                                    <div className="mass-engage__head">
                                      <span className="mass-engage__title">Mass engagement</span>
                                      <span className="mass-engage__pool">
                                        {slaveAccounts.length} slave account{slaveAccounts.length === 1 ? '' : 's'}
                                        {(slaveLikeCount > 0 || slaveRepostCount > 0) &&
                                          ` · ${slaveLikeCount} liked · ${slaveRepostCount} reposted`}
                                      </span>
                                    </div>
                                    {slaveAccounts.length === 0 ? (
                                      <p className="mass-engage__hint">
                                        Add accounts in “Slave Accounts” to enable mass liking and reposting.
                                      </p>
                                    ) : (
                                      <>
                                        <div className="mass-engage__row">
                                          <label className="mass-engage__field">
                                            <span>Likes</span>
                                            <input
                                              className="cred-form__input mass-engage__input"
                                              type="number"
                                              min={0}
                                              max={slaveAccounts.length}
                                              placeholder="0"
                                              value={inputs.like}
                                              onChange={(e) => setEngagementInput(post.id, 'like', e.target.value)}
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            className="btn btn--ghost"
                                            disabled={Boolean(massBusy)}
                                            onClick={() =>
                                              setEngagementInput(post.id, 'like', String(slaveAccounts.length))
                                            }
                                          >
                                            Max
                                          </button>
                                          <button
                                            type="button"
                                            className="btn"
                                            disabled={
                                              Boolean(massBusy) ||
                                              successful.length === 0 ||
                                              !inputs.like ||
                                              parseInt(inputs.like, 10) <= 0
                                            }
                                            onClick={() => void massLikePost(post, parseInt(inputs.like || '0', 10))}
                                          >
                                            Like
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn--ghost"
                                            disabled={Boolean(massBusy) || slaveLikeCount === 0}
                                            onClick={() => void massUnlikePost(post)}
                                          >
                                            Unlike all
                                          </button>
                                        </div>
                                        <div className="mass-engage__row">
                                          <label className="mass-engage__field">
                                            <span>Reposts</span>
                                            <input
                                              className="cred-form__input mass-engage__input"
                                              type="number"
                                              min={0}
                                              max={slaveAccounts.length}
                                              placeholder="0"
                                              value={inputs.repost}
                                              onChange={(e) => setEngagementInput(post.id, 'repost', e.target.value)}
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            className="btn btn--ghost"
                                            disabled={Boolean(massBusy)}
                                            onClick={() =>
                                              setEngagementInput(post.id, 'repost', String(slaveAccounts.length))
                                            }
                                          >
                                            Max
                                          </button>
                                          <button
                                            type="button"
                                            className="btn"
                                            disabled={
                                              Boolean(massBusy) ||
                                              successful.length === 0 ||
                                              !inputs.repost ||
                                              parseInt(inputs.repost, 10) <= 0
                                            }
                                            onClick={() => void massRepostPost(post, parseInt(inputs.repost || '0', 10))}
                                          >
                                            Repost
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn--ghost"
                                            disabled={Boolean(massBusy) || slaveRepostCount === 0}
                                            onClick={() => void massUnrepostPost(post)}
                                          >
                                            Un-repost all
                                          </button>
                                        </div>
                                        {massBusy && <p className="mass-engage__status">{massBusy}</p>}
                                      </>
                                    )}
                                  </div>
                                )}
                                <div className="post-engagement-card__actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    disabled={refreshingPostStats === post.id || successful.length === 0}
                                    onClick={() => void refreshPostEngagement(post)}
                                  >
                                    {refreshingPostStats === post.id ? 'Refreshing…' : 'Refresh stats'}
                                  </button>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      className="license-row__delete"
                                      disabled={deletingProfilePost === post.id || successful.length === 0}
                                      onClick={() => void deleteProfilePost(post)}
                                      title="Delete from Bluesky profile (keeps video in library)"
                                    >
                                      {deletingProfilePost === post.id ? '…' : '✕'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}
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
                          placeholder="Label (e.g. US-1, adriel)"
                          value={newProxyLabel}
                          onChange={(e) => setNewProxyLabel(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                        />
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
                          adminOption
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
                  {proxies.length > 0 && (
                    <div className="account-search">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search proxies…"
                        value={proxySearch}
                        onChange={(e) => setProxySearch(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {proxySearch && (
                        <button type="button" className="account-search__clear" onClick={() => setProxySearch('')}>
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                  {proxies.length === 0 ? (
                    <p className="empty-note">Nothing here yet.</p>
                  ) : filteredProxies.length === 0 ? (
                    <p className="empty-note">No proxies match “{proxySearch}”.</p>
                  ) : (
                    <div className="proxy-list">
                      {filteredProxies.map((proxy) => (
                        <div key={proxy.id} className="proxy-row">
                          <div className="proxy-row__body">
                            <div className="proxy-row__top">
                              {proxy.label?.trim() && (
                                <strong className="proxy-row__name">{proxy.label.trim()}</strong>
                              )}
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
                              {proxyLinkedAccounts(proxy).map((handle) => (
                                <span key={handle} className="owner-tag owner-tag--account">
                                  @{handle}
                                </span>
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
                        <SavedAccountPicker
                          accounts={savedAccounts}
                          value={selectedSavedId}
                          onChange={pickSavedAccount}
                        />
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

                      <ProxyPicker
                        proxies={proxies}
                        value={acctProxyId}
                        onChange={setAcctProxyId}
                        optionLabel={proxyOptionLabel}
                      />

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
                        const localRs = runState[acct.id];
                        const remote = remoteRuns[acct.id];
                        const remoteRs: RunState | null = remote
                          ? {
                              state: remote.state,
                              text: remote.text,
                              done: remote.done,
                              total: remote.total,
                              result: {
                                success: remote.success,
                                skipped: remote.skipped,
                                failed: remote.failed,
                                total: remote.total,
                                cancelled: false,
                              },
                              live: remote.live,
                            }
                          : null;
                        const rs = localRs ?? remoteRs;
                        const pct = rs && rs.total ? Math.round((rs.done / rs.total) * 100) : 0;
                        const canManage = isAdmin || acct.employees.includes(session.username);
                        const isEditing = editingAccountId === acct.id && editDraft;
                        const isLocalActive =
                          Boolean(localRs) && localRs.state !== 'done' && localRs.state !== 'error';
                        const isRemoteActive =
                          !localRs &&
                          Boolean(remote) &&
                          remote!.active &&
                          Date.now() - remote!.updatedAt < RUN_STALE_MS;
                        const isActive = isLocalActive || isRemoteActive;
                        return (
                          <div key={acct.id} className={`follow-card follow-card--${rs?.state ?? 'idle'}`}>
                            {isEditing ? (
                              <form className="bio-form follow-card__edit" onSubmit={saveEditAccount}>
                                <input
                                  className="cred-form__input"
                                  placeholder="Handle or email (e.g. name.bsky.social)"
                                  value={editDraft!.identifier}
                                  onChange={(e) => updateDraft('identifier', e.target.value)}
                                  autoComplete="off"
                                />
                                <input
                                  className="cred-form__input"
                                  type="text"
                                  placeholder="App password (xxxx-xxxx-xxxx-xxxx)"
                                  value={editDraft!.password}
                                  onChange={(e) => updateDraft('password', e.target.value)}
                                  autoComplete="off"
                                />

                                {targets.length > 0 && (
                                  <label className="cred-field">
                                    <span className="cred-field__label">Saved target profile</span>
                                    <select
                                      className="cred-form__input"
                                      value={targets.some((t) => t.handle === editDraft!.target) ? editDraft!.target : ''}
                                      onChange={(e) => updateDraft('target', e.target.value)}
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
                                  value={editDraft!.target}
                                  onChange={(e) => updateDraft('target', e.target.value)}
                                  autoComplete="off"
                                />

                                <label className="cred-field">
                                  <span className="cred-field__label">Max follows for this account</span>
                                  <input
                                    type="number"
                                    className="cred-form__input"
                                    value={editDraft!.maxFollowers ?? DEFAULT_MAX_FOLLOWERS}
                                    min={1}
                                    onChange={(e) => updateDraft('maxFollowers', Number(e.target.value))}
                                  />
                                </label>

                                <label className="cred-field">
                                  <span className="cred-field__label">Follow interval for this account</span>
                                  <select
                                    className="cred-form__input"
                                    value={editDraft!.delayMode ?? 'fixed'}
                                    onChange={(e) => updateDraft('delayMode', e.target.value as 'fixed' | 'random')}
                                  >
                                    <option value="fixed">Fixed delay</option>
                                    <option value="random">Random range</option>
                                  </select>
                                </label>
                                {(editDraft!.delayMode ?? 'fixed') === 'fixed' ? (
                                  <label className="cred-field">
                                    <span className="cred-field__label">Delay between follows (ms)</span>
                                    <input
                                      type="number"
                                      className="cred-form__input"
                                      value={editDraft!.delayMs ?? DEFAULT_DELAY_MS}
                                      min={0}
                                      onChange={(e) => updateDraft('delayMs', Number(e.target.value))}
                                    />
                                  </label>
                                ) : (
                                  <div className="follow-range">
                                    <label className="cred-field">
                                      <span className="cred-field__label">Min delay (ms)</span>
                                      <input
                                        type="number"
                                        className="cred-form__input"
                                        value={editDraft!.delayMin ?? DEFAULT_DELAY_MIN}
                                        min={0}
                                        onChange={(e) => updateDraft('delayMin', Number(e.target.value))}
                                      />
                                    </label>
                                    <label className="cred-field">
                                      <span className="cred-field__label">Max delay (ms)</span>
                                      <input
                                        type="number"
                                        className="cred-form__input"
                                        value={editDraft!.delayMax ?? DEFAULT_DELAY_MAX}
                                        min={0}
                                        onChange={(e) => updateDraft('delayMax', Number(e.target.value))}
                                      />
                                    </label>
                                  </div>
                                )}

                                <ProxyPicker
                                  proxies={proxies}
                                  value={editDraft!.proxyId ?? ''}
                                  onChange={(id) => updateDraft('proxyId', id || undefined)}
                                  optionLabel={proxyOptionLabel}
                                />

                                <label className="follow-skip">
                                  <input
                                    type="checkbox"
                                    checked={editDraft!.skipExisting ?? true}
                                    onChange={(e) => updateDraft('skipExisting', e.target.checked)}
                                  />
                                  Skip people already followed
                                </label>

                                <div className="row-actions">
                                  <button
                                    type="submit"
                                    disabled={
                                      !editDraft!.identifier.trim() ||
                                      !editDraft!.password.trim() ||
                                      !editDraft!.target.trim()
                                    }
                                  >
                                    Save changes
                                  </button>
                                  <button type="button" className="btn btn--ghost" onClick={cancelEditAccount}>
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
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
                                        🌐 {proxies.find((p) => p.id === acct.proxyId) ? proxyOptionLabel(proxies.find((p) => p.id === acct.proxyId)!) : 'proxy'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="row-actions">
                                    {isAdmin && <div className="bio-row__assign">{renderAssignTags(acct)}</div>}
                                    {isLocalActive ? (
                                      <button type="button" className="row-edit row-edit--stop" title="Stop this account" onClick={() => stopOne(acct.id)}>
                                        ■
                                      </button>
                                    ) : isRemoteActive ? (
                                      <span className="follow-card__elsewhere" title="Running on another device">
                                        <span className="follow-running__pulse" aria-hidden />
                                        running elsewhere
                                      </span>
                                    ) : (
                                      <>
                                        {canManage && (
                                          <button type="button" className="row-edit" title="Edit this account" onClick={() => startEditAccount(acct)}>
                                            ✎
                                          </button>
                                        )}
                                        <button type="button" className="row-edit" title="Run this account" onClick={() => runOne(acct)}>
                                          ▶
                                        </button>
                                        {canManage && (
                                          <button type="button" className="license-row__delete" onClick={() => handleDeleteAccount(acct.id)} title="Delete">
                                            ✕
                                          </button>
                                        )}
                                      </>
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

        {profilePicCropFile && (
          <SquareImageCropModal
            file={profilePicCropFile}
            onCancel={() => setProfilePicCropFile(null)}
            onConfirm={(blob) => {
              setProfilePicCropFile(null);
              void uploadProfilePic(new File([blob], 'profile-pic.jpg', { type: 'image/jpeg' }));
            }}
          />
        )}

        {assignBioItem && (
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

              <p className="cred-note">Select which employees will see this bio in their library.</p>

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

        {editBioItem && (
          <div className="modal" onClick={closeEditBioModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void saveBioEdit();
              }}
            >
              <div className="modal__head">
                <h3>Edit bio</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeEditBioModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="schedule-modal__body">
                <textarea
                  className="bio-form__textarea"
                  placeholder="Write the bio…"
                  value={editBioText}
                  onChange={(e) => setEditBioText(e.target.value)}
                  rows={6}
                  autoFocus
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeEditBioModal}>
                  Cancel
                </button>
                <button type="submit" disabled={savingBioEdit || !editBioText.trim()}>
                  {savingBioEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        )}

        {addBioOpen && (
          <div className="modal" onClick={closeAddBioModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void saveBioAdd();
              }}
            >
              <div className="modal__head">
                <h3>Add bio</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAddBioModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="schedule-modal__body">
                <textarea
                  className="bio-form__textarea"
                  placeholder="Write the bio…"
                  value={bioText}
                  onChange={(e) => setBioText(e.target.value)}
                  rows={6}
                  autoFocus
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAddBioModal}>
                  Cancel
                </button>
                <button type="submit" disabled={savingBioAdd || !bioText.trim()}>
                  {savingBioAdd ? 'Adding…' : 'Add bio'}
                </button>
              </div>
            </form>
          </div>
        )}

        {assignProfilePic && (
          <div className="modal" onClick={closeAssignProfilePicModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void saveProfilePicAssign();
              }}
            >
              <div className="modal__head">
                <h3>Assign profile picture</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAssignProfilePicModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="cred-note">
                Select which employees will see this profile picture in their library.
              </p>

              <div className="schedule-modal__body">
                <AssignmentPicker
                  employees={employees}
                  selected={assignProfilePicEmployees}
                  all={assignProfilePicAll}
                  onToggle={toggleAssignProfilePicEmployee}
                  onAllChange={setAssignProfilePicAll}
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAssignProfilePicModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    savingProfilePicAssign ||
                    (!assignProfilePicAll && assignProfilePicEmployees.size === 0)
                  }
                >
                  {savingProfilePicAssign ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        )}

        {assignBanner && (
          <div className="modal" onClick={closeAssignBannerModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void saveBannerAssign();
              }}
            >
              <div className="modal__head">
                <h3>Assign banner</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAssignBannerModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="cred-note">Select which employees will see this banner in their library.</p>

              <div className="schedule-modal__body">
                <AssignmentPicker
                  employees={employees}
                  selected={assignBannerEmployees}
                  all={assignBannerAll}
                  onToggle={toggleAssignBannerEmployee}
                  onAllChange={setAssignBannerAll}
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAssignBannerModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBannerAssign || (!assignBannerAll && assignBannerEmployees.size === 0)}
                >
                  {savingBannerAssign ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        )}

        {assignPost && (
          <div className="modal" onClick={closeAssignPostModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void savePostAssign();
              }}
            >
              <div className="modal__head">
                <h3>Assign post</h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closeAssignPostModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="cred-note">Select which employees can post this item to their Bluesky accounts.</p>

              <div className="schedule-modal__body">
                <AssignmentPicker
                  employees={employees}
                  selected={assignPostEmployees}
                  all={assignPostAll}
                  onToggle={toggleAssignPostEmployee}
                  onAllChange={setAssignPostAll}
                />
              </div>

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closeAssignPostModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPostAssign || (!assignPostAll && assignPostEmployees.size === 0)}
                >
                  {savingPostAssign ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        )}

        {postCaptionModal && (
          <div className="modal" onClick={closePostCaptionModal}>
            <form
              className="modal__card"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                void publishLibraryPost(
                  postCaptionModal.post,
                  postCaptionText,
                  postHashtagsText,
                  postPublishProxyId,
                  postPublishAccountIds,
                  postPublishAllAccounts,
                );
              }}
            >
              <div className="modal__head">
                <h3>
                  Post {postCaptionModal.post.mediaType === 'video' ? 'video' : 'image'} to Bluesky
                </h3>
                <button
                  type="button"
                  className="modal__close"
                  onClick={closePostCaptionModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="schedule-modal__body">
                <label className="cred-field">
                  <span className="cred-field__label">Caption</span>
                  <textarea
                    className="bio-form__textarea"
                    placeholder="Write a caption…"
                    value={postCaptionText}
                    onChange={(e) => setPostCaptionText(e.target.value)}
                    rows={4}
                  />
                </label>

                <label className="cred-field">
                  <span className="cred-field__label">Hashtags</span>
                  <input
                    className="cred-form__input"
                    placeholder="e.g. blonde, travel, fyp"
                    value={postHashtagsText}
                    onChange={(e) => setPostHashtagsText(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <span className="cred-field__hint">
                    Separate with spaces or commas. The “#” is added automatically and they’ll
                    appear blue and clickable on Bluesky.
                  </span>
                </label>

                {activePostAssignedOwners && (
                  <p className="cred-field__hint">
                    Assigned to:{' '}
                    {postCaptionModal.post.allEmployees && (postCaptionModal.post.employees?.length ?? 0) === 0
                      ? 'All employees'
                      : activePostAssignedOwners.join(', ')}
                  </p>
                )}

                <SavedAccountMultiPicker
                  accounts={activePostPublishAccounts}
                  selected={postPublishAccountIds}
                  all={postPublishAllAccounts}
                  onToggle={togglePostPublishAccount}
                  onAllChange={setPostPublishAllAccounts}
                  label="Bluesky accounts"
                  hint={
                    activePostAssignedOwners
                      ? 'Showing accounts added by the assigned employee(s) only.'
                      : 'Showing all accounts with saved credentials. Assign an employee to limit this list.'
                  }
                />

                <label className="cred-field">
                  <span className="cred-field__label">Proxy (optional)</span>
                  <select
                    className="cred-form__input"
                    value={postPublishProxyId}
                    onChange={(e) => setPostPublishProxyId(e.target.value)}
                  >
                    <option value="">
                      {activePostProxies.length === 0 ? 'No proxies available' : 'No proxy'}
                    </option>
                    {activePostProxies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {proxyOptionLabel(p)}
                      </option>
                    ))}
                  </select>
                  <span className="cred-field__hint">
                    Route this publish through a proxy assigned to the selected employee(s).
                  </span>
                </label>
              </div>

              {postPublishingId === postCaptionModal.post.id && postPublishProgress && (
                <div className="profile-push-progress--panel">
                  <ProfilePushProgressBar progress={postPublishProgress} />
                </div>
              )}

              <div className="schedule-modal__actions">
                <button type="button" className="btn btn--ghost" onClick={closePostCaptionModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    postPublishingId === postCaptionModal.post.id ||
                    activePostPublishAccounts.length === 0 ||
                    (!postPublishAllAccounts && postPublishAccountIds.size === 0)
                  }
                >
                  {postPublishingId === postCaptionModal.post.id ? 'Posting…' : 'Post to Bluesky'}
                </button>
              </div>
            </form>
          </div>
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
