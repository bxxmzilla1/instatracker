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
    dbPromise = openDB<InstatrackerDB>('instatracker-v1', 1, {
      upgrade(db) {
        db.createObjectStore('accounts', { keyPath: 'username' });
        const followerStore = db.createObjectStore('followerHistory', {
          keyPath: 'capturedAt',
          autoIncrement: true,
        });
        followerStore.createIndex('by-username', 'username');
        followerStore.createIndex('by-date', 'capturedAt');

        const reelStore = db.createObjectStore('reelSnapshots', {
          keyPath: 'capturedAt',
          autoIncrement: true,
        });
        reelStore.createIndex('by-username', 'username');
        reelStore.createIndex('by-reel', 'id');
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
      snapshots: [],
    };
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
