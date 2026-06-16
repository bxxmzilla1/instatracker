import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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

type ContentRecord = Omit<ContentReel, 'videoUrl'> & { videoUrl?: string; blob?: Blob };

interface InstatrackerDB extends DBSchema {
  accounts: {
    key: string;
    value: TrackedAccount;
  };
  employees: {
    key: string;
    value: Employee;
  };
  licenses: {
    key: string;
    value: License;
  };
  proxies: {
    key: string;
    value: Proxy;
  };
  bios: {
    key: string;
    value: Bio;
  };
  ctas: {
    key: string;
    value: Cta;
  };
  stories: {
    key: string;
    value: StoryNote;
  };
  content: {
    key: string;
    value: ContentRecord;
  };
  followerHistory: {
    key: number;
    value: FollowerSnapshot;
    indexes: { 'by-username': string; 'by-date': number };
  };
  reelSnapshots: {
    key: number;
    value: ReelSnapshot;
    indexes: { 'by-username': string; 'by-reel': string };
  };
}

let dbPromise: Promise<IDBPDatabase<InstatrackerDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<InstatrackerDB>('instatracker-v1', 9, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'username' });
        }

        if (!db.objectStoreNames.contains('employees')) {
          db.createObjectStore('employees', { keyPath: 'username' });
        }

        if (!db.objectStoreNames.contains('licenses')) {
          db.createObjectStore('licenses', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('proxies')) {
          db.createObjectStore('proxies', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('bios')) {
          db.createObjectStore('bios', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('ctas')) {
          db.createObjectStore('ctas', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('stories')) {
          db.createObjectStore('stories', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('content')) {
          db.createObjectStore('content', { keyPath: 'id' });
        }

        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('followerHistory')) {
            db.deleteObjectStore('followerHistory');
          }
          if (db.objectStoreNames.contains('reelSnapshots')) {
            db.deleteObjectStore('reelSnapshots');
          }
        }

        if (!db.objectStoreNames.contains('followerHistory')) {
          const followerStore = db.createObjectStore('followerHistory', {
            autoIncrement: true,
          });
          followerStore.createIndex('by-username', 'username');
          followerStore.createIndex('by-date', 'capturedAt');
        }

        if (!db.objectStoreNames.contains('reelSnapshots')) {
          const reelStore = db.createObjectStore('reelSnapshots', {
            autoIncrement: true,
          });
          reelStore.createIndex('by-username', 'username');
          reelStore.createIndex('by-reel', 'id');
        }
      },
    });
  }
  return dbPromise;
}

export async function getAccounts(owner?: string): Promise<TrackedAccount[]> {
  const db = await getDb();
  let accounts = await db.getAll('accounts');

  if (owner === 'admin') {
    accounts = accounts.filter((a) => !a.owner || a.owner === 'admin');
  } else if (owner !== undefined) {
    accounts = accounts.filter((a) => a.owner === owner);
  }

  return accounts.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getEmployees(): Promise<Employee[]> {
  const db = await getDb();
  const employees = await db.getAll('employees');
  return employees.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addEmployee(employee: Employee): Promise<void> {
  const db = await getDb();
  await db.put('employees', employee);
}

export async function deleteEmployee(username: string): Promise<void> {
  const db = await getDb();
  await db.delete('employees', username);
}

export async function getLicenses(employee?: string): Promise<License[]> {
  const db = await getDb();
  let licenses = await db.getAll('licenses');
  if (employee !== undefined) {
    licenses = licenses.filter((l) => matchesEmployee(l, employee));
  }
  return licenses.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addLicense(license: License): Promise<void> {
  const db = await getDb();
  await db.put('licenses', license);
}

export async function deleteLicense(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('licenses', id);
}

export async function getProxies(employee?: string): Promise<Proxy[]> {
  const db = await getDb();
  let proxies = await db.getAll('proxies');
  if (employee !== undefined) {
    proxies = proxies.filter((p) => matchesEmployee(p, employee));
  }
  return proxies.sort((a, b) => a.createdAt - b.createdAt);
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
  let bios = await db.getAll('bios');
  if (employee !== undefined) {
    bios = bios.filter((b) => b.allEmployees || b.employees.includes(employee));
  }
  return bios.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addBio(bio: Bio): Promise<void> {
  const db = await getDb();
  await db.put('bios', bio);
}

export async function deleteBio(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('bios', id);
}

export async function getCtas(employee?: string): Promise<Cta[]> {
  const db = await getDb();
  let ctas = await db.getAll('ctas');
  if (employee !== undefined) {
    ctas = ctas.filter((c) => c.allEmployees || c.employees.includes(employee));
  }
  return ctas.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addCta(cta: Cta): Promise<void> {
  const db = await getDb();
  await db.put('ctas', cta);
}

export async function getStories(employee?: string): Promise<StoryNote[]> {
  const db = await getDb();
  let stories = await db.getAll('stories');
  if (employee !== undefined) {
    stories = stories.filter((s) => s.allEmployees || s.employees.includes(employee));
  }
  return stories.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addStory(story: StoryNote): Promise<void> {
  const db = await getDb();
  await db.put('stories', story);
}

export async function deleteStory(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('stories', id);
}

export async function getContent(employee?: string): Promise<ContentReel[]> {
  const db = await getDb();
  let rows = await db.getAll('content');
  if (employee !== undefined) {
    rows = rows.filter((r) => r.allEmployees || r.employees.includes(employee));
  }
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      caption: r.caption,
      videoUrl: r.blob ? URL.createObjectURL(r.blob) : (r.videoUrl ?? ''),
      mediaType: r.mediaType ?? 'reel',
      employees: r.employees,
      allEmployees: r.allEmployees,
      targetAccount: r.targetAccount,
      scheduledAt: r.scheduledAt,
      createdAt: r.createdAt,
    }));
}

export async function addContent(reel: ContentReel, file?: Blob): Promise<void> {
  const db = await getDb();
  const record: ContentRecord = {
    id: reel.id,
    caption: reel.caption,
    mediaType: reel.mediaType ?? 'reel',
    employees: reel.employees,
    allEmployees: reel.allEmployees,
    targetAccount: reel.targetAccount,
    scheduledAt: reel.scheduledAt,
    createdAt: reel.createdAt,
  };
  if (file) record.blob = file;
  else record.videoUrl = reel.videoUrl;
  await db.put('content', record);
}

export async function deleteContent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('content', id);
}

export async function deleteCta(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('ctas', id);
}

export async function addAccount(account: TrackedAccount): Promise<void> {
  const db = await getDb();
  await db.put('accounts', account);
}

export async function removeAccount(username: string): Promise<void> {
  const db = await getDb();
  await db.delete('accounts', username.toLowerCase());

  const followerKeys = await db.getAllKeysFromIndex('followerHistory', 'by-username', username.toLowerCase());
  for (const key of followerKeys) await db.delete('followerHistory', key);

  const reelKeys = await db.getAllKeysFromIndex('reelSnapshots', 'by-username', username.toLowerCase());
  for (const key of reelKeys) await db.delete('reelSnapshots', key);
}

export async function updateAccount(account: TrackedAccount): Promise<void> {
  const db = await getDb();
  await db.put('accounts', account);
}

export async function saveFollowerSnapshot(snapshot: FollowerSnapshot): Promise<void> {
  const db = await getDb();
  await db.add('followerHistory', snapshot);
}

export async function getFollowerHistory(username: string): Promise<FollowerSnapshot[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('followerHistory', 'by-username', username.toLowerCase());
  return rows.sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function getAllReelSnapshots(): Promise<ReelSnapshot[]> {
  const db = await getDb();
  return db.getAll('reelSnapshots');
}

export async function getAllFollowerSnapshots(): Promise<FollowerSnapshot[]> {
  const db = await getDb();
  return db.getAll('followerHistory');
}

export async function saveReelSnapshots(snapshots: ReelSnapshot[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('reelSnapshots', 'readwrite');
  for (const snapshot of snapshots) {
    await tx.store.add(snapshot);
  }
  await tx.done;
}

export async function getReelHistories(username: string): Promise<ReelHistory[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('reelSnapshots', 'by-username', username.toLowerCase());
  return groupReelHistories(rows);
}

export function groupReelHistories(rows: ReelSnapshot[]): ReelHistory[] {
  const grouped = new Map<string, ReelHistory>();

  for (const row of rows) {
    const existing = grouped.get(row.id) ?? {
      reelId: row.id,
      username: row.username,
      shortcode: row.shortcode,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      takenAt: row.takenAt,
      snapshots: [],
    };
    if (row.thumbnailUrl) existing.thumbnailUrl = row.thumbnailUrl;
    if (row.caption) existing.caption = row.caption;
    if (row.takenAt) existing.takenAt = row.takenAt;
    existing.snapshots.push({
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      capturedAt: row.capturedAt,
    });
    grouped.set(row.id, existing);
  }

  return [...grouped.values()].map((history) => ({
    ...history,
    snapshots: history.snapshots.sort((a, b) => a.capturedAt - b.capturedAt),
  }));
}
