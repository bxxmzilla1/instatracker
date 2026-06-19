export const TOKEN_UPDATE_NOTE = 'API token needs to be updated';
export const SCHEDULE_ERROR_LABEL = 'Error found. Check Notes';
export const SCHEDULE_PUBLISH_STALE_MS = 2 * 60 * 1000;
export const SCHEDULE_PUBLISH_TIMEOUT_MS = 2 * 60 * 1000;
export const SCHEDULE_PUBLISH_TIMEOUT_MESSAGE = 'Publish timed out while preparing media';

export function isAccessTokenError(message) {
  return /validating access token|invalid access token|access token has expired|session has been invalidated|log in to www\.instagram\.com|OAuthException|instagram api error \(401\)/i.test(
    message,
  );
}

export function noteTextForPublishError(message) {
  const trimmed = String(message || '').trim();
  if (!trimmed || trimmed === SCHEDULE_ERROR_LABEL) return 'Scheduled post failed';
  if (isAccessTokenError(trimmed)) return TOKEN_UPDATE_NOTE;
  return trimmed;
}

export function resolveSkipNoteText(post) {
  if (post.skipReason?.trim()) return post.skipReason;
  if (post.postError?.trim() && post.postError !== SCHEDULE_ERROR_LABEL) return post.postError;
  return 'Scheduled post failed';
}
