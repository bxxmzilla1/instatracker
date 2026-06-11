import { isSupabaseConfigured, supabase } from './supabase';

export interface SavedCredentials {
  username: string;
  password: string;
}

const LS_KEY = 'drbossing_credentials';
const ROW_ID = 1;

export async function saveCredentials(creds: SavedCredentials): Promise<void> {
  localStorage.setItem(LS_KEY, JSON.stringify(creds));

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from('credentials').upsert({
        id: ROW_ID,
        username: creds.username,
        password: creds.password,
        updated_at: Date.now(),
      });
    } catch {
      // ignore network/db errors so login still works
    }
  }
}

export async function clearSavedCredentials(): Promise<void> {
  localStorage.removeItem(LS_KEY);

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from('credentials').delete().eq('id', ROW_ID);
    } catch {
      // ignore
    }
  }
}

export async function loadCredentials(): Promise<SavedCredentials | null> {
  const local = localStorage.getItem(LS_KEY);
  if (local) {
    try {
      const parsed = JSON.parse(local) as SavedCredentials;
      if (parsed?.username && parsed?.password) return parsed;
    } catch {
      // fall through to remote
    }
  }

  if (isSupabaseConfigured && supabase) {
    try {
      const { data } = await supabase
        .from('credentials')
        .select('username, password')
        .eq('id', ROW_ID)
        .maybeSingle();
      if (data?.username && data?.password) {
        const creds = { username: data.username, password: data.password };
        localStorage.setItem(LS_KEY, JSON.stringify(creds));
        return creds;
      }
    } catch {
      // ignore
    }
  }

  return null;
}
