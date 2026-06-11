import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FollowerSnapshot, ReelHistory, ReelSnapshot, TrackedAccount } from '../types';

interface InstatrackerDB extends DBSchema {
  accounts: {
    key: string;
    value: TrackedAccount;
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
    dbPromise = openDB<InstatrackerDB>('instatracker-v1', 2, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'username' });
        }

        // v1 used `capturedAt` as the primary key, which collides when many
        // reels share the same refresh timestamp. Recreate with autoIncrement.
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

export async function getAccounts(): Promise<TrackedAccount[]> {
  const db = await getDb();
  const accounts = await db.getAll('accounts');
  return accounts.sort((a, b) => b.addedAt - a.addedAt);
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
  const grouped = new Map<string, ReelHistory>();

  for (const row of rows) {
    const existing = grouped.get(row.id) ?? {
      reelId: row.id,
      username: row.username,
      shortcode: row.shortcode,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      snapshots: [],
    };
    if (row.thumbnailUrl) existing.thumbnailUrl = row.thumbnailUrl;
    if (row.caption) existing.caption = row.caption;
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
