import { TOKEN_UPDATE_NOTE } from './instagramErrors.js';

function normalizeAccount(username) {
  return String(username || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

/** Upsert a token-expired note for an account and mark it unseen (badge). */
export async function upsertTokenUpdateNote(db, username) {
  const account = normalizeAccount(username);
  if (!account) return;

  const id = `token-${account}`;
  const now = Date.now();
  const { error } = await db.from('account_notes').upsert({
    id,
    account,
    text: TOKEN_UPDATE_NOTE,
    seen: false,
    created_at: now,
  });
  if (error) throw new Error(error.message);
}

/** Remove a scheduled post from the queue (skip permanently). */
export async function skipScheduledPost(db, rowId, postId) {
  const { data: row, error } = await db.from('content').select('*').eq('id', rowId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const posts = Array.isArray(row.scheduled_posts) ? row.scheduled_posts : [];
  const skipped = posts.find((post) => post.id === postId);
  const updated = posts.filter((post) => post.id !== postId);

  const { error: updateError } = await db
    .from('content')
    .update({
      scheduled_posts: updated,
      scheduled_at: null,
      target_account: null,
      post_error: null,
      publishing_at: null,
      publish_stage: null,
    })
    .eq('id', rowId);
  if (updateError) throw new Error(updateError.message);

  return skipped?.account ?? null;
}
