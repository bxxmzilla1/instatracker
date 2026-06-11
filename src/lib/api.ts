import { extractReelsCursor, parseProfileResponse, parseReelsResponse } from './parse';
import type { ParsedProfile, ParsedReel } from '../types';

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || 'Request failed');
  }
  return data as T;
}

export async function fetchProfile(username: string): Promise<ParsedProfile> {
  const data = await post<unknown>('/api/profile', { username });
  return parseProfileResponse(data, username);
}

export async function fetchReels(username: string, maxId?: string): Promise<{
  reels: ParsedReel[];
  nextCursor?: string;
}> {
  const data = await post<unknown>('/api/reels', { username, maxId });
  return {
    reels: parseReelsResponse(data),
    nextCursor: extractReelsCursor(data),
  };
}

export async function checkHealth(): Promise<{ ok: boolean; hasKey: boolean }> {
  const response = await fetch('/api/health');
  return response.json();
}
