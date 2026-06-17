import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { matchesEmployee } from '../assignment';
import type {
  Bio,
  BskyAccount,
  BskyFollowEvent,
  BskyPost,
  BskyRun,
  BskySavedAccount,
  BskyTarget,
  Cta,
  Employee,
  ImageAsset,
  Proxy,
} from '../../types';

type ImageRecord = Omit<ImageAsset, 'url'> & { url?: string; blob?: Blob };
type PostRecord = Omit<BskyPost, 'imageUrl'> & { imageUrl?: string; blob?: Blob };

interface BskyDB extends DBSchema {
  employees: { key: string; value: Employee };
  proxies: { key: string; value: Proxy };
  bios: { key: string; value: Bio };
  ctas: { key: string; value: Cta };
  banners: { key: string; value: ImageRecord };
  profilePics: { key: string; value: ImageRecord };
  posts: { key: string; value: PostRecord };
  accounts: { key: string; value: BskyAccount };
  savedAccounts: { key: string; value: BskySavedAccount };
  targets: { key: string; value: BskyTarget };
  followEvents: { key: string; value: BskyFollowEvent };
  runs: { key: string; value: BskyRun };
}

let dbPromise: Promise<IDBPDatabase<BskyDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<BskyDB>('drbossing-bsky-v1', 5, {
      upgrade(db) {
        for (const store of [
          'employees',
          'proxies',
          'bios',
          'ctas',
          'banners',
          'profilePics',
          'posts',
          'accounts',
          'savedAccounts',
          'targets',
          'followEvents',
          'runs',
        ] as const) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, {
              keyPath: store === 'employees' ? 'username' : store === 'runs' ? 'accountId' : 'id',
            });
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function getEmployees(): Promise<Employee[]> {
  const db = await getDb();
  const rows = await db.getAll('employees');
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addEmployee(employee: Employee): Promise<void> {
  const db = await getDb();
  await db.put('employees', employee);
}

export async function deleteEmployee(username: string): Promise<void> {
  const db = await getDb();
  await db.delete('employees', username);
}

export async function getProxies(employee?: string): Promise<Proxy[]> {
  const db = await getDb();
  let rows = await db.getAll('proxies');
  if (employee !== undefined) rows = rows.filter((p) => matchesEmployee(p, employee));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addProxy(proxy: Proxy): Promise<void> {
  const db = await getDb();
  await db.put('proxies', proxy);
}

export async function deleteProxy(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('proxies', id);
}

export async function getBios(employee?: string): Promise<Bio[]> {
  const db = await getDb();
  let rows = await db.getAll('bios');
  if (employee !== undefined) rows = rows.filter((b) => b.allEmployees || b.employees.includes(employee));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addBio(bio: Bio): Promise<void> {
  const db = await getDb();
  await db.put('bios', bio);
}

export async function updateBio(bio: Bio): Promise<void> {
  const db = await getDb();
  const existing = await db.get('bios', bio.id);
  if (!existing) throw new Error('Bio not found');
  await db.put('bios', {
    ...existing,
    text: bio.text,
    employees: bio.employees,
    allEmployees: bio.allEmployees,
  });
}

export async function deleteBio(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('bios', id);
}

export async function getCtas(employee?: string): Promise<Cta[]> {
  const db = await getDb();
  let rows = await db.getAll('ctas');
  if (employee !== undefined) rows = rows.filter((c) => c.allEmployees || c.employees.includes(employee));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addCta(cta: Cta): Promise<void> {
  const db = await getDb();
  await db.put('ctas', cta);
}

export async function deleteCta(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('ctas', id);
}

function mapImage(r: ImageRecord): ImageAsset {
  return {
    id: r.id,
    url: r.blob ? URL.createObjectURL(r.blob) : (r.url ?? ''),
    caption: r.caption,
    employees: r.employees,
    allEmployees: r.allEmployees,
    createdAt: r.createdAt,
  };
}

async function getImages(store: 'banners' | 'profilePics', employee?: string): Promise<ImageAsset[]> {
  const db = await getDb();
  let rows = await db.getAll(store);
  if (employee !== undefined) rows = rows.filter((r) => r.allEmployees || r.employees.includes(employee));
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(mapImage);
}

async function addImage(store: 'banners' | 'profilePics', asset: ImageAsset, file?: Blob): Promise<void> {
  const db = await getDb();
  const record: ImageRecord = {
    id: asset.id,
    caption: asset.caption,
    employees: asset.employees,
    allEmployees: asset.allEmployees,
    createdAt: asset.createdAt,
  };
  if (file) record.blob = file;
  else record.url = asset.url;
  await db.put(store, record);
}

export const getBanners = (employee?: string) => getImages('banners', employee);
export const addBanner = (asset: ImageAsset, file?: Blob) => addImage('banners', asset, file);
export async function updateBanner(asset: ImageAsset): Promise<void> {
  const db = await getDb();
  const existing = await db.get('banners', asset.id);
  if (!existing) throw new Error('Banner not found');
  await db.put('banners', {
    ...existing,
    employees: asset.employees,
    allEmployees: asset.allEmployees,
    caption: asset.caption,
  });
}
export async function deleteBanner(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('banners', id);
}

export const getProfilePics = (employee?: string) => getImages('profilePics', employee);
export const addProfilePic = (asset: ImageAsset, file?: Blob) => addImage('profilePics', asset, file);
export async function updateProfilePic(asset: ImageAsset): Promise<void> {
  const db = await getDb();
  const existing = await db.get('profilePics', asset.id);
  if (!existing) throw new Error('Profile picture not found');
  await db.put('profilePics', {
    ...existing,
    employees: asset.employees,
    allEmployees: asset.allEmployees,
    caption: asset.caption,
  });
}
export async function deleteProfilePic(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('profilePics', id);
}

export async function getPosts(employee?: string): Promise<BskyPost[]> {
  const db = await getDb();
  let rows = await db.getAll('posts');
  if (employee !== undefined) rows = rows.filter((p) => p.allEmployees || p.employees.includes(employee));
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      text: r.text,
      imageUrl: r.blob ? URL.createObjectURL(r.blob) : r.imageUrl,
      employees: r.employees,
      allEmployees: r.allEmployees,
      scheduledAt: r.scheduledAt,
      createdAt: r.createdAt,
    }));
}

export async function addPost(post: BskyPost, file?: Blob): Promise<void> {
  const db = await getDb();
  const record: PostRecord = {
    id: post.id,
    text: post.text,
    employees: post.employees,
    allEmployees: post.allEmployees,
    scheduledAt: post.scheduledAt,
    createdAt: post.createdAt,
  };
  if (file) record.blob = file;
  else record.imageUrl = post.imageUrl;
  await db.put('posts', record);
}

export async function deletePost(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('posts', id);
}

export async function getBskyAccounts(employee?: string): Promise<BskyAccount[]> {
  const db = await getDb();
  let rows = await db.getAll('accounts');
  if (employee !== undefined) rows = rows.filter((a) => a.allEmployees || a.employees.includes(employee));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addBskyAccount(account: BskyAccount): Promise<void> {
  const db = await getDb();
  await db.put('accounts', account);
}

export async function deleteBskyAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('accounts', id);
}

export async function getSavedAccounts(owner?: string): Promise<BskySavedAccount[]> {
  const db = await getDb();
  let rows = await db.getAll('savedAccounts');
  if (owner === 'admin') rows = rows.filter((a) => !a.owner || a.owner === 'admin');
  else if (owner !== undefined) rows = rows.filter((a) => a.owner === owner);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addSavedAccount(account: BskySavedAccount): Promise<void> {
  const db = await getDb();
  await db.put('savedAccounts', account);
}

export async function deleteSavedAccount(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('savedAccounts', id);
}

export async function getTargets(employee?: string): Promise<BskyTarget[]> {
  const db = await getDb();
  let rows = await db.getAll('targets');
  if (employee !== undefined) rows = rows.filter((t) => t.allEmployees || t.employees.includes(employee));
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addTarget(target: BskyTarget): Promise<void> {
  const db = await getDb();
  await db.put('targets', target);
}

export async function deleteTarget(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('targets', id);
}

export async function getFollowEvents(): Promise<BskyFollowEvent[]> {
  const db = await getDb();
  const rows = await db.getAll('followEvents');
  return rows.sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function addFollowEvent(event: BskyFollowEvent): Promise<void> {
  const db = await getDb();
  await db.put('followEvents', event);
}

export async function addFollowEvents(events: BskyFollowEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('followEvents', 'readwrite');
  await Promise.all(events.map((e) => tx.store.put(e)));
  await tx.done;
}

export async function getRuns(): Promise<BskyRun[]> {
  const db = await getDb();
  return db.getAll('runs');
}

export async function upsertRun(run: BskyRun): Promise<void> {
  const db = await getDb();
  await db.put('runs', run);
}
