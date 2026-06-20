import { supabase } from '../supabase';
import { matchesEmployee } from '../assignment';
import type {
  Bio,
  BskyAccount,
  BskyFollowEvent,
  BskyPost,
  BskyRun,
  BskySavedAccount,
  BskySlaveAccount,
  BskyTarget,
  BskyWarmupRun,
  Cta,
  Employee,
  ImageAsset,
  Proxy,
} from '../../types';

function client() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getEmployees(): Promise<Employee[]> {
  const { data, error } = await client()
    .from('bsky_employees')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { username: string; password: string | null; created_at: number | null }[]).map(
    (row) => ({ username: row.username, password: row.password ?? '', createdAt: row.created_at ?? 0 }),
  );
}

export async function addEmployee(employee: Employee): Promise<void> {
  const { error } = await client()
    .from('bsky_employees')
    .upsert({ username: employee.username, password: employee.password, created_at: employee.createdAt });
  if (error) throw new Error(error.message);
}

export async function deleteEmployee(username: string): Promise<void> {
  const { error } = await client().from('bsky_employees').delete().eq('username', username);
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
  label: string | null;
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
    label: row.label ?? undefined,
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    employee: row.employee ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getProxies(employee?: string): Promise<Proxy[]> {
  const { data, error } = await client()
    .from('bsky_proxies')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let proxies = (data as ProxyRow[]).map(toProxy);
  if (employee !== undefined) proxies = proxies.filter((p) => matchesEmployee(p, employee));
  return proxies;
}

export async function addProxy(proxy: Proxy): Promise<void> {
  const { error } = await client().from('bsky_proxies').upsert({
    id: proxy.id,
    raw: proxy.raw,
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
    rotating_link: proxy.rotatingLink,
    label: proxy.label ?? null,
    employee: proxy.employee ?? null,
    employees: proxy.employees,
    all_employees: proxy.allEmployees,
    created_at: proxy.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteProxy(id: string): Promise<void> {
  const { error } = await client().from('bsky_proxies').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface TextRow {
  id: string;
  text: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toText<T extends Bio | Cta>(row: TextRow): T {
  return {
    id: row.id,
    text: row.text ?? '',
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    createdAt: row.created_at ?? 0,
  } as T;
}

async function getText<T extends Bio | Cta>(table: string, employee?: string): Promise<T[]> {
  const { data, error } = await client().from(table).select('*').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let rows = (data as TextRow[]).map((r) => toText<T>(r));
  if (employee !== undefined) rows = rows.filter((r) => r.allEmployees || r.employees.includes(employee));
  return rows;
}

async function addText(table: string, item: Bio | Cta): Promise<void> {
  const { error } = await client().from(table).upsert({
    id: item.id,
    text: item.text,
    employees: item.employees,
    all_employees: item.allEmployees,
    created_at: item.createdAt,
  });
  if (error) throw new Error(error.message);
}

export const getBios = (employee?: string) => getText<Bio>('bsky_bios', employee);
export const addBio = (bio: Bio) => addText('bsky_bios', bio);
export async function updateBio(bio: Bio): Promise<void> {
  const { error } = await client()
    .from('bsky_bios')
    .update({
      text: bio.text,
      employees: bio.employees,
      all_employees: bio.allEmployees,
    })
    .eq('id', bio.id);
  if (error) throw new Error(error.message);
}
export async function deleteBio(id: string): Promise<void> {
  const { error } = await client().from('bsky_bios').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export const getCtas = (employee?: string) => getText<Cta>('bsky_ctas', employee);
export const addCta = (cta: Cta) => addText('bsky_ctas', cta);
export async function deleteCta(id: string): Promise<void> {
  const { error } = await client().from('bsky_ctas').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface ImageRow {
  id: string;
  url: string | null;
  caption: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toImage(row: ImageRow): ImageAsset {
  return {
    id: row.id,
    url: row.url ?? '',
    caption: row.caption ?? undefined,
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    createdAt: row.created_at ?? 0,
  };
}

async function uploadMedia(folder: string, id: string, file: Blob): Promise<string> {
  const db = client();
  const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg';
  const path = `bsky/${folder}/${id}.${ext}`;
  const { error } = await db.storage.from('media').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
    cacheControl: '604800',
  });
  if (error) throw new Error(error.message);
  return db.storage.from('media').getPublicUrl(path).data?.publicUrl ?? '';
}

async function getImages(table: string, employee?: string): Promise<ImageAsset[]> {
  const { data, error } = await client().from(table).select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (data as ImageRow[]).map(toImage);
  if (employee !== undefined) rows = rows.filter((r) => r.allEmployees || r.employees.includes(employee));
  return rows;
}

async function addImage(table: string, folder: string, asset: ImageAsset, file?: Blob): Promise<void> {
  let url = asset.url;
  if (file) url = await uploadMedia(folder, asset.id, file);
  const { error } = await client().from(table).upsert({
    id: asset.id,
    url,
    caption: asset.caption ?? null,
    employees: asset.employees,
    all_employees: asset.allEmployees,
    created_at: asset.createdAt,
  });
  if (error) throw new Error(error.message);
}

export const getBanners = (employee?: string) => getImages('bsky_banners', employee);
export const addBanner = (asset: ImageAsset, file?: Blob) => addImage('bsky_banners', 'banners', asset, file);
export async function updateBanner(asset: ImageAsset): Promise<void> {
  const { error } = await client()
    .from('bsky_banners')
    .update({
      employees: asset.employees,
      all_employees: asset.allEmployees,
      caption: asset.caption ?? null,
    })
    .eq('id', asset.id);
  if (error) throw new Error(error.message);
}
export async function deleteBanner(id: string): Promise<void> {
  const { error } = await client().from('bsky_banners').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export const getProfilePics = (employee?: string) => getImages('bsky_profile_pics', employee);
export const addProfilePic = (asset: ImageAsset, file?: Blob) =>
  addImage('bsky_profile_pics', 'profile_pics', asset, file);
export async function updateProfilePic(asset: ImageAsset): Promise<void> {
  const { error } = await client()
    .from('bsky_profile_pics')
    .update({
      employees: asset.employees,
      all_employees: asset.allEmployees,
      caption: asset.caption ?? null,
    })
    .eq('id', asset.id);
  if (error) throw new Error(error.message);
}
export async function deleteProfilePic(id: string): Promise<void> {
  const { error } = await client().from('bsky_profile_pics').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface PostRow {
  id: string;
  text: string | null;
  image_url: string | null;
  video_url: string | null;
  media_type: string | null;
  publishes: unknown;
  employees: unknown;
  all_employees: boolean | null;
  scheduled_at: number | null;
  created_at: number | null;
}

function toPost(row: PostRow): BskyPost {
  return {
    id: row.id,
    text: row.text ?? '',
    imageUrl: row.image_url ?? undefined,
    videoUrl: row.video_url ?? undefined,
    mediaType:
      row.media_type === 'video'
        ? 'video'
        : row.media_type === 'image'
          ? 'image'
          : row.media_type === 'text'
            ? 'text'
            : undefined,
    publishes: Array.isArray(row.publishes) ? (row.publishes as BskyPost['publishes']) : [],
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    scheduledAt: row.scheduled_at ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getPosts(employee?: string): Promise<BskyPost[]> {
  const { data, error } = await client()
    .from('bsky_posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (data as PostRow[]).map(toPost);
  if (employee !== undefined) rows = rows.filter((p) => p.allEmployees || p.employees.includes(employee));
  return rows;
}

export async function addPost(post: BskyPost, file?: Blob): Promise<void> {
  let imageUrl = post.imageUrl;
  let videoUrl = post.videoUrl;
  if (file) {
    if (post.mediaType === 'video') {
      videoUrl = await uploadMedia('posts', `${post.id}-video`, file);
    } else {
      imageUrl = await uploadMedia('posts', post.id, file);
    }
  }
  const { error } = await client().from('bsky_posts').upsert({
    id: post.id,
    text: post.text,
    image_url: imageUrl ?? null,
    video_url: videoUrl ?? null,
    media_type: post.mediaType ?? null,
    publishes: post.publishes ?? [],
    employees: post.employees,
    all_employees: post.allEmployees,
    scheduled_at: post.scheduledAt ?? null,
    created_at: post.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function updatePost(post: BskyPost): Promise<void> {
  const { error } = await client()
    .from('bsky_posts')
    .update({
      text: post.text,
      image_url: post.imageUrl ?? null,
      video_url: post.videoUrl ?? null,
      media_type: post.mediaType ?? null,
      publishes: post.publishes ?? [],
      employees: post.employees,
      all_employees: post.allEmployees,
      scheduled_at: post.scheduledAt ?? null,
    })
    .eq('id', post.id);
  if (error) throw new Error(error.message);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await client().from('bsky_posts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface AccountRow {
  id: string;
  identifier: string | null;
  password: string | null;
  target: string | null;
  type: string | null;
  service: string | null;
  proxy_id: string | null;
  max_followers: number | null;
  skip_existing: boolean | null;
  delay_mode: string | null;
  delay_ms: number | null;
  delay_min: number | null;
  delay_max: number | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toAccount(row: AccountRow): BskyAccount {
  return {
    id: row.id,
    identifier: row.identifier ?? '',
    password: row.password ?? '',
    target: row.target ?? '',
    type: row.type === 'following' ? 'following' : 'followers',
    service: row.service ?? undefined,
    proxyId: row.proxy_id ?? undefined,
    maxFollowers: row.max_followers ?? undefined,
    skipExisting: row.skip_existing ?? undefined,
    delayMode: row.delay_mode === 'random' ? 'random' : row.delay_mode === 'fixed' ? 'fixed' : undefined,
    delayMs: row.delay_ms ?? undefined,
    delayMin: row.delay_min ?? undefined,
    delayMax: row.delay_max ?? undefined,
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    createdAt: row.created_at ?? 0,
  };
}

export async function getBskyAccounts(employee?: string): Promise<BskyAccount[]> {
  const { data, error } = await client()
    .from('bsky_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  let rows = (data as AccountRow[]).map(toAccount);
  if (employee !== undefined) rows = rows.filter((a) => a.allEmployees || a.employees.includes(employee));
  return rows;
}

export async function addBskyAccount(account: BskyAccount): Promise<void> {
  const { error } = await client().from('bsky_accounts').upsert({
    id: account.id,
    identifier: account.identifier,
    password: account.password,
    target: account.target,
    type: account.type,
    service: account.service ?? null,
    proxy_id: account.proxyId ?? null,
    max_followers: account.maxFollowers ?? null,
    skip_existing: account.skipExisting ?? null,
    delay_mode: account.delayMode ?? null,
    delay_ms: account.delayMs ?? null,
    delay_min: account.delayMin ?? null,
    delay_max: account.delayMax ?? null,
    employees: account.employees,
    all_employees: account.allEmployees,
    created_at: account.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteBskyAccount(id: string): Promise<void> {
  const { error } = await client().from('bsky_accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface SavedAccountRow {
  id: string;
  handle: string | null;
  email: string | null;
  password: string | null;
  notes: string | null;
  owner: string | null;
  banned: boolean | null;
  created_at: number | null;
}

function toSavedAccount(row: SavedAccountRow): BskySavedAccount {
  return {
    id: row.id,
    handle: row.handle ?? '',
    email: row.email ?? undefined,
    password: row.password ?? undefined,
    notes: row.notes ?? undefined,
    owner: row.owner ?? undefined,
    banned: row.banned ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

export async function getSavedAccounts(owner?: string): Promise<BskySavedAccount[]> {
  let query = client()
    .from('bsky_saved_accounts')
    .select('*')
    .order('created_at', { ascending: false });
  if (owner === 'admin') query = query.or('owner.eq.admin,owner.is.null');
  else if (owner !== undefined) query = query.eq('owner', owner);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as SavedAccountRow[]).map(toSavedAccount);
}

export async function addSavedAccount(account: BskySavedAccount): Promise<void> {
  const { error } = await client().from('bsky_saved_accounts').upsert({
    id: account.id,
    handle: account.handle,
    email: account.email ?? null,
    password: account.password ?? null,
    notes: account.notes ?? null,
    owner: account.owner ?? null,
    banned: account.banned ?? null,
    created_at: account.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSavedAccount(id: string): Promise<void> {
  const { error } = await client().from('bsky_saved_accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface SlaveAccountRow {
  id: string;
  handle: string | null;
  password: string | null;
  proxy_id: string | null;
  note: string | null;
  created_at: number | null;
}

function toSlaveAccount(row: SlaveAccountRow): BskySlaveAccount {
  return {
    id: row.id,
    handle: row.handle ?? '',
    password: row.password ?? '',
    proxyId: row.proxy_id ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at ?? 0,
  };
}

// True when an error looks like the `note` column hasn't been migrated yet, so
// callers can transparently retry without it instead of dropping the write.
function isMissingNoteColumn(message: string): boolean {
  return /note/i.test(message) && /column|schema|does not exist|could not find/i.test(message);
}

export async function getSlaveAccounts(): Promise<BskySlaveAccount[]> {
  const { data, error } = await client()
    .from('bsky_slave_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as SlaveAccountRow[]).map(toSlaveAccount);
}

export async function addSlaveAccount(account: BskySlaveAccount): Promise<void> {
  const base = {
    id: account.id,
    handle: account.handle,
    password: account.password,
    proxy_id: account.proxyId ?? null,
    created_at: account.createdAt,
  };
  let { error } = await client()
    .from('bsky_slave_accounts')
    .upsert({ ...base, note: account.note ?? null });
  // Fall back gracefully if the schema migration adding `note` hasn't run yet.
  if (error && isMissingNoteColumn(error.message)) {
    ({ error } = await client().from('bsky_slave_accounts').upsert(base));
  }
  if (error) throw new Error(error.message);
}

export async function deleteSlaveAccount(id: string): Promise<void> {
  const { error } = await client().from('bsky_slave_accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface TargetRow {
  id: string;
  handle: string | null;
  notes: string | null;
  employees: unknown;
  all_employees: boolean | null;
  created_at: number | null;
}

function toTarget(row: TargetRow): BskyTarget {
  return {
    id: row.id,
    handle: row.handle ?? '',
    notes: row.notes ?? undefined,
    employees: Array.isArray(row.employees) ? (row.employees as string[]) : [],
    allEmployees: row.all_employees ?? false,
    createdAt: row.created_at ?? 0,
  };
}

export async function getTargets(employee?: string): Promise<BskyTarget[]> {
  const { data, error } = await client()
    .from('bsky_targets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  let rows = (data as TargetRow[]).map(toTarget);
  if (employee !== undefined) rows = rows.filter((t) => t.allEmployees || t.employees.includes(employee));
  return rows;
}

export async function addTarget(target: BskyTarget): Promise<void> {
  const { error } = await client().from('bsky_targets').upsert({
    id: target.id,
    handle: target.handle,
    notes: target.notes ?? null,
    employees: target.employees,
    all_employees: target.allEmployees,
    created_at: target.createdAt,
  });
  if (error) throw new Error(error.message);
}

export async function deleteTarget(id: string): Promise<void> {
  const { error } = await client().from('bsky_targets').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface FollowEventRow {
  id: string;
  account_id: string | null;
  count: number | null;
  captured_at: number | null;
  owner?: string | null;
}

function toFollowEvent(row: FollowEventRow): BskyFollowEvent {
  return {
    id: row.id,
    accountId: row.account_id ?? '',
    // Postgres bigint columns come back as strings — coerce so arithmetic on
    // these values adds instead of concatenating.
    count: Number(row.count ?? 0),
    capturedAt: Number(row.captured_at ?? 0),
    owner: row.owner ?? undefined,
  };
}

export async function getFollowEvents(): Promise<BskyFollowEvent[]> {
  // Page through all rows — a plain select() is capped at 1000 rows, which
  // would silently stop the dashboard totals from growing past that point.
  const pageSize = 1000;
  const out: BskyFollowEvent[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client()
      .from('bsky_follow_events')
      .select('*')
      .order('captured_at', { ascending: true })
      .range(from, from + pageSize - 1);
    // Fail soft so the dashboard still loads before the schema migration is applied.
    if (error) return out;
    const rows = (data as FollowEventRow[]).map(toFollowEvent);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// True when an error looks like the `owner` column hasn't been migrated yet, so
// callers can transparently retry without it instead of dropping the write.
function isMissingOwnerColumn(message: string): boolean {
  return /owner/i.test(message) && /column|schema|does not exist|could not find/i.test(message);
}

export async function addFollowEvent(event: BskyFollowEvent): Promise<void> {
  const base = {
    id: event.id,
    account_id: event.accountId,
    count: event.count,
    captured_at: event.capturedAt,
  };
  let { error } = await client()
    .from('bsky_follow_events')
    .upsert({ ...base, owner: event.owner ?? null });
  if (error && isMissingOwnerColumn(error.message)) {
    ({ error } = await client().from('bsky_follow_events').upsert(base));
  }
  if (error) throw new Error(error.message);
}

export async function addFollowEvents(events: BskyFollowEvent[]): Promise<void> {
  if (events.length === 0) return;
  const base = events.map((e) => ({
    id: e.id,
    account_id: e.accountId,
    count: e.count,
    captured_at: e.capturedAt,
  }));
  let { error } = await client()
    .from('bsky_follow_events')
    .upsert(events.map((e, i) => ({ ...base[i], owner: e.owner ?? null })));
  // Fall back gracefully if the schema migration adding `owner` hasn't run yet.
  if (error && isMissingOwnerColumn(error.message)) {
    ({ error } = await client().from('bsky_follow_events').upsert(base));
  }
  if (error) throw new Error(error.message);
}

interface AccountRunRow {
  account_id: string;
  identifier: string | null;
  owner: string | null;
  state: string | null;
  text: string | null;
  done: number | string | null;
  total: number | string | null;
  success: number | string | null;
  skipped: number | string | null;
  failed: number | string | null;
  live: string | null;
  active: boolean | null;
  updated_at: number | string | null;
}

function toRun(row: AccountRunRow): BskyRun {
  return {
    accountId: row.account_id,
    identifier: row.identifier ?? undefined,
    owner: row.owner ?? undefined,
    state: row.state ?? 'idle',
    text: row.text ?? '',
    done: Number(row.done ?? 0),
    total: Number(row.total ?? 0),
    success: Number(row.success ?? 0),
    skipped: Number(row.skipped ?? 0),
    failed: Number(row.failed ?? 0),
    live: row.live ?? '',
    active: row.active ?? false,
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export async function getRuns(): Promise<BskyRun[]> {
  const { data, error } = await client().from('bsky_account_runs').select('*');
  // Fail soft so the UI still works before the schema migration is applied.
  if (error) return [];
  return (data as AccountRunRow[]).map(toRun);
}

export async function upsertRun(run: BskyRun): Promise<void> {
  const { error } = await client().from('bsky_account_runs').upsert({
    account_id: run.accountId,
    identifier: run.identifier ?? null,
    owner: run.owner ?? null,
    state: run.state,
    text: run.text,
    done: run.done,
    total: run.total,
    success: run.success,
    skipped: run.skipped,
    failed: run.failed,
    live: run.live,
    active: run.active,
    updated_at: run.updatedAt,
  });
  if (error) throw new Error(error.message);
}

interface WarmupRunRow {
  account_key: string;
  handle: string | null;
  kind: string | null;
  status: string | null;
  step: number | string | null;
  total_steps: number | string | null;
  label: string | null;
  error: string | null;
  owner: string | null;
  active: boolean | null;
  updated_at: number | string | null;
  claimed_by: string | null;
  queue_order: number | string | null;
  cancel_requested: boolean | null;
}

function toWarmupRun(row: WarmupRunRow): BskyWarmupRun {
  const kind = row.kind === 'slave' ? 'slave' : 'follow';
  const statusRaw = row.status ?? 'waiting';
  const status =
    statusRaw === 'running' || statusRaw === 'done' || statusRaw === 'error'
      ? statusRaw
      : 'waiting';
  return {
    accountKey: row.account_key,
    handle: row.handle ?? '',
    kind,
    status,
    step: Number(row.step ?? 0),
    totalSteps: Number(row.total_steps ?? 0),
    label: row.label ?? '',
    error: row.error ?? undefined,
    owner: row.owner ?? undefined,
    active: row.active ?? false,
    updatedAt: Number(row.updated_at ?? 0),
    claimedBy: row.claimed_by ?? undefined,
    queueOrder: row.queue_order != null ? Number(row.queue_order) : undefined,
    cancelRequested: row.cancel_requested ?? false,
  };
}

export async function getWarmupRuns(): Promise<BskyWarmupRun[]> {
  const { data, error } = await client().from('bsky_warmup_runs').select('*');
  if (error) return [];
  return (data as WarmupRunRow[]).map(toWarmupRun);
}

export async function upsertWarmupRun(run: BskyWarmupRun): Promise<void> {
  const { error } = await client().from('bsky_warmup_runs').upsert({
    account_key: run.accountKey,
    handle: run.handle,
    kind: run.kind,
    status: run.status,
    step: run.step,
    total_steps: run.totalSteps,
    label: run.label,
    error: run.error ?? null,
    owner: run.owner ?? null,
    active: run.active,
    updated_at: run.updatedAt,
    claimed_by: run.claimedBy ?? null,
    queue_order: run.queueOrder ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteWarmupRun(accountKey: string): Promise<void> {
  const { error } = await client().from('bsky_warmup_runs').delete().eq('account_key', accountKey);
  if (error) throw new Error(error.message);
}

/**
 * Flags a run so whichever executor owns it (possibly on another device) stops
 * at its next checkpoint. upsertWarmupRun never writes this column, so progress
 * heartbeats won't clear the request before the executor sees it.
 */
export async function requestWarmupCancel(accountKey: string): Promise<void> {
  const { error } = await client()
    .from('bsky_warmup_runs')
    .update({ cancel_requested: true })
    .eq('account_key', accountKey);
  if (error) throw new Error(error.message);
}
