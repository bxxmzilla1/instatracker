import { supabase } from './supabase';
import { groupReelHistories } from './dbLocal';
import { matchesEmployee } from './assignment';
import type {
  Bio,
  ContentReel,
  Cta,
  Employee,
  FollowerSnapshot,
  License,
  Proxy,
  ReelHistory,
  ReelSnapshot,
  StoryNote,
  TrackedAccount,
} from '../types';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

interface AccountRow {
  username: string;
  added_at: number;
  full_name: string | null;
  bio: string | null;
  profile_pic_url: string | null;
  is_verified: boolean | null;
  last_followers: number | null;
  last_following: number | null;
  last_media_count: number | null;
  last_checked_at: number | null;
  stories: unknown;
  login_username: string | null;
  login_email: string | null;
  login_phone: string | null;
  login_password: string | null;
  auth_secret: string | null;
  owner: string | null;
  banned: boolean | null;
  banned_at: number | null;
}

interface ReelRow {
  reel_id: string;
  username: string;
  shortcode: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  captured_at: number;
  taken_at: number | null;
}

interface FollowerRow {
  username: string;
  followers: number | null;
  following: number | null;
  media_count: number | null;
  captured_at: number;
}

function toAccount(row: AccountRow): TrackedAccount {
  return {
    username: row.username,
    addedAt: row.added_at,
    fullName: row.full_name ?? undefined,
    bio: row.bio ?? undefined,
    profilePicUrl: row.profile_pic_url ?? undefined,
    isVerified: row.is_verified ?? undefined,
    lastFollowers: row.last_followers ?? undefined,
    lastFollowing: row.last_following ?? undefined,
    lastMediaCount: row.last_media_count ?? undefined,
    lastCheckedAt: row.last_checked_at ?? undefined,
    stories: Array.isArray(row.stories) ? (row.stories as TrackedAccount['stories']) : [],
    loginUsername: row.login_username ?? undefined,
    loginEmail: row.login_email ?? undefined,
    loginPhone: row.login_phone ?? undefined,
    loginPassword: row.login_password ?? undefined,
    authSecret: row.auth_secret ?? undefined,
    owner: row.owner ?? undefined,
    banned: row.banned ?? undefined,
    bannedAt: row.banned_at ?? undefined,
  };
}

function fromAccount(account: TrackedAccount): AccountRow {
  return {
    username: account.username,
    added_at: account.addedAt,
    full_name: account.fullName ?? null,
    bio: account.bio ?? null,
    profile_pic_url: account.profilePicUrl ?? null,
    is_verified: account.isVerified ?? null,
    last_followers: account.lastFollowers ?? null,
    last_following: account.lastFollowing ?? null,
    last_media_count: account.lastMediaCount ?? null,
    last_checked_at: account.lastCheckedAt ?? null,
    stories: account.stories ?? [],
    login_username: account.loginUsername ?? null,
    login_email: account.loginEmail ?? null,
    login_phone: account.loginPhone ?? null,
    login_password: account.loginPassword ?? null,
    auth_secret: account.authSecret ?? null,
    owner: account.owner ?? null,
    banned: account.banned ?? false,
    banned_at: account.bannedAt ?? null,
  };
}

function toReelSnapshot(row: ReelRow): ReelSnapshot {
  return {
    id: row.reel_id,
    username: row.username,
    shortcode: row.shortcode ?? '',
    caption: row.caption ?? '',
    thumbnailUrl: row.thumbnail_url ?? undefined,
    views: row.views ?? 0,
    likes: row.likes ?? 0,
    comments: row.comments ?? 0,
    capturedAt: row.captured_at,
    takenAt: row.taken_at ?? undefined,
  };
}

function toFollowerSnapshot(row: FollowerRow): FollowerSnapshot {
  return {
    username: row.username,
    followers: row.followers ?? 0,
    following: row.following ?? 0,
    mediaCount: row.media_count ?? 0,
    capturedAt: row.captured_at,
  };
}

export async function getAccounts(owner?: string): Promise<TrackedAccount[]> {
  let query = client().from('accounts').select('*').order('added_at', { ascending: false });

  if (owner === 'admin') {
    query = query.or('owner.eq.admin,owner.is.null');
  } else if (owner !== undefined) {
    query = query.eq('owner', owner);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as AccountRow[]).map(toAccount);
}

export async function getEmployees(): Promise<Employee[]> {
  const { data, error } = await client()
    .from('employees')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { username: string; password: string | null; created_at: number | null }[]).map(
    (row) => ({
      username: row.username,
      password: row.password ?? '',
      createdAt: row.created_at ?? 0,
    }),
  );
}

export async function addEmployee(employee: Employee): Promise<void> {
  const { error } = await client().from('employees').upsert({
    username: employee.username,
    password: employee.password,
    created_at: employee.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteEmployee(username: string): Promise<void> {
  const { error } = await client().from('employees').delete().eq('username', username);
  if (error) throw new Error(error.message);
}

interface LicenseRow {
  id: string;
  license: string | null;
  employee: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toLicense(row: LicenseRow): License {
  return {
    id: row.id,
    license: row.license ?? '',
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    employee: row.employee ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getLicenses(employee?: string): Promise<License[]> {
  const { data, error } = await client()
    .from('licenses')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let licenses = (data as LicenseRow[]).map(toLicense);
  if (employee !== undefined) {
    licenses = licenses.filter((l) => matchesEmployee(l, employee));
  }
  return licenses;
}

export async function addLicense(license: License): Promise<void> {
  const { error } = await client().from('licenses').upsert({
    id: license.id,
    license: license.license,
    employee: license.employee ?? null,
    employees: license.employees,
    all_employees: license.allEmployees,
    created_at: license.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteLicense(id: string): Promise<void> {
  const { error } = await client().from('licenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface ProxyRow {
  id: string;
  raw: string | null;
  type: string | null;
  host: string | null;
  port: string | null;
  username: string | null;
  password: string | null;
  rotating_link: string | null;
  employee: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toProxy(row: ProxyRow): Proxy {
  return {
    id: row.id,
    raw: row.raw ?? '',
    type: row.type ?? 'http',
    host: row.host ?? '',
    port: row.port ?? '',
    username: row.username ?? '',
    password: row.password ?? '',
    rotatingLink: row.rotating_link ?? '',
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    employee: row.employee ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getProxies(employee?: string): Promise<Proxy[]> {
  const { data, error } = await client()
    .from('proxies')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let proxies = (data as ProxyRow[]).map(toProxy);
  if (employee !== undefined) {
    proxies = proxies.filter((p) => matchesEmployee(p, employee));
  }
  return proxies;
}

export async function addProxy(proxy: Proxy): Promise<void> {
  const { error } = await client().from('proxies').upsert({
    id: proxy.id,
    raw: proxy.raw,
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
    rotating_link: proxy.rotatingLink,
    employee: proxy.employee ?? null,
    employees: proxy.employees,
    all_employees: proxy.allEmployees,
    created_at: proxy.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteProxy(id: string): Promise<void> {
  const { error } = await client().from('proxies').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface BioRow {
  id: string;
  text: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toBio(row: BioRow): Bio {
  return {
    id: row.id,
    text: row.text ?? '',
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    createdAt: row.created_at ?? 0,
  };
}

export async function getBios(employee?: string): Promise<Bio[]> {
  const { data, error } = await client()
    .from('bios')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let bios = (data as BioRow[]).map(toBio);
  if (employee !== undefined) {
    bios = bios.filter((b) => b.allEmployees || b.employees.includes(employee));
  }
  return bios;
}

export async function addBio(bio: Bio): Promise<void> {
  const { error } = await client().from('bios').upsert({
    id: bio.id,
    text: bio.text,
    employees: bio.employees,
    all_employees: bio.allEmployees,
    created_at: bio.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteBio(id: string): Promise<void> {
  const { error } = await client().from('bios').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getCtas(employee?: string): Promise<Cta[]> {
  const { data, error } = await client()
    .from('ctas')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let ctas = (data as BioRow[]).map(toBio) as Cta[];
  if (employee !== undefined) {
    ctas = ctas.filter((c) => c.allEmployees || c.employees.includes(employee));
  }
  return ctas;
}

export async function addCta(cta: Cta): Promise<void> {
  const { error } = await client().from('ctas').upsert({
    id: cta.id,
    text: cta.text,
    employees: cta.employees,
    all_employees: cta.allEmployees,
    created_at: cta.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteCta(id: string): Promise<void> {
  const { error } = await client().from('ctas').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getStories(employee?: string): Promise<StoryNote[]> {
  const { data, error } = await client()
    .from('stories')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let stories = (data as BioRow[]).map(toBio) as StoryNote[];
  if (employee !== undefined) {
    stories = stories.filter((s) => s.allEmployees || s.employees.includes(employee));
  }
  return stories;
}

export async function addStory(story: StoryNote): Promise<void> {
  const { error } = await client().from('stories').upsert({
    id: story.id,
    text: story.text,
    employees: story.employees,
    all_employees: story.allEmployees,
    created_at: story.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteStory(id: string): Promise<void> {
  const { error } = await client().from('stories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface ContentRow {
  id: string;
  caption: string | null;
  video_url: string | null;
  employees: unknown;
  all_employees: boolean | null;
  scheduled_at: number | null;
  created_at: number | null;
}

function toContent(row: ContentRow): ContentReel {
  return {
    id: row.id,
    caption: row.caption ?? '',
    videoUrl: row.video_url ?? '',
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    scheduledAt: row.scheduled_at ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getContent(employee?: string): Promise<ContentReel[]> {
  const { data, error } = await client()
    .from('content')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (data as ContentRow[]).map(toContent);
  if (employee !== undefined) {
    rows = rows.filter((r) => r.allEmployees || r.employees.includes(employee));
  }
  return rows;
}

export async function addContent(reel: ContentReel, file?: Blob): Promise<void> {
  const db = client();
  let videoUrl = reel.videoUrl;

  if (file) {
    const ext = file.type === 'video/webm' ? 'webm' : 'mp4';
    const path = `content/${reel.id}.${ext}`;
    const { error: uploadError } = await db.storage.from('media').upload(path, file, {
      upsert: true,
      contentType: file.type || 'video/mp4',
      cacheControl: '604800',
    });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = db.storage.from('media').getPublicUrl(path);
    videoUrl = data?.publicUrl ?? videoUrl;
  }

  const { error } = await db.from('content').upsert({
    id: reel.id,
    caption: reel.caption,
    video_url: videoUrl,
    employees: reel.employees,
    all_employees: reel.allEmployees,
    scheduled_at: reel.scheduledAt ?? null,
    created_at: reel.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteContent(id: string): Promise<void> {
  const { error } = await client().from('content').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function addAccount(account: TrackedAccount): Promise<void> {
  const { error } = await client().from('accounts').upsert(fromAccount(account));
  if (error) throw new Error(error.message);
}

export async function updateAccount(account: TrackedAccount): Promise<void> {
  const { error } = await client().from('accounts').upsert(fromAccount(account));
  if (error) throw new Error(error.message);
}

export async function removeAccount(username: string): Promise<void> {
  const db = client();
  const name = username.toLowerCase();
  await db.from('reel_snapshots').delete().eq('username', name);
  await db.from('follower_snapshots').delete().eq('username', name);
  const { error } = await db.from('accounts').delete().eq('username', name);
  if (error) throw new Error(error.message);
}

export async function saveFollowerSnapshot(snapshot: FollowerSnapshot): Promise<void> {
  const { error } = await client().from('follower_snapshots').insert({
    username: snapshot.username,
    followers: snapshot.followers,
    following: snapshot.following,
    media_count: snapshot.mediaCount,
    captured_at: snapshot.capturedAt,
  });
  if (error) throw new Error(error.message);
}

export async function getFollowerHistory(username: string): Promise<FollowerSnapshot[]> {
  const { data, error } = await client()
    .from('follower_snapshots')
    .select('*')
    .eq('username', username.toLowerCase())
    .order('captured_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as FollowerRow[]).map(toFollowerSnapshot);
}

export async function getAllFollowerSnapshots(): Promise<FollowerSnapshot[]> {
  const { data, error } = await client().from('follower_snapshots').select('*');
  if (error) throw new Error(error.message);
  return (data as FollowerRow[]).map(toFollowerSnapshot);
}

export async function saveReelSnapshots(snapshots: ReelSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const rows = snapshots.map((snapshot) => ({
    reel_id: snapshot.id,
    username: snapshot.username,
    shortcode: snapshot.shortcode,
    caption: snapshot.caption,
    thumbnail_url: snapshot.thumbnailUrl ?? null,
    views: snapshot.views,
    likes: snapshot.likes,
    comments: snapshot.comments,
    captured_at: snapshot.capturedAt,
    taken_at: snapshot.takenAt ?? null,
  }));
  const { error } = await client().from('reel_snapshots').insert(rows);
  if (error) throw new Error(error.message);
}

export async function getAllReelSnapshots(): Promise<ReelSnapshot[]> {
  const { data, error } = await client().from('reel_snapshots').select('*');
  if (error) throw new Error(error.message);
  return (data as ReelRow[]).map(toReelSnapshot);
}

export async function getReelHistories(username: string): Promise<ReelHistory[]> {
  const { data, error } = await client()
    .from('reel_snapshots')
    .select('*')
    .eq('username', username.toLowerCase());
  if (error) throw new Error(error.message);
  return groupReelHistories((data as ReelRow[]).map(toReelSnapshot));
}
