export const TOKEN_UPDATE_NOTE = 'API token needs to be updated';
export const SCHEDULE_ERROR_LABEL = 'Error found. Check Notes';
export const SCHEDULE_PUBLISH_STALE_MS = 2 * 60 * 1000;
export const SCHEDULE_PUBLISH_TIMEOUT_MS = 2 * 60 * 1000;
export const SCHEDULE_PUBLISH_TIMEOUT_MESSAGE = 'Publish timed out while preparing media';

/** True when Instagram rejected the request because the Graph API token is invalid or expired. */
export function isAccessTokenError(message: string): boolean {
  return /validating access token|invalid access token|access token has expired|session has been invalidated|log in to www\.instagram\.com|OAuthException|instagram api error \(401\)/i.test(
    message,
  );
}

/** Note text saved when a publish fails for an account. */
export function noteTextForPublishError(
  message: string,
  fallback = 'Scheduled post failed',
): string {
  const trimmed = (message || '').trim();
  if (!trimmed || trimmed === SCHEDULE_ERROR_LABEL) return fallback;
  if (isAccessTokenError(trimmed)) return TOKEN_UPDATE_NOTE;
  return trimmed;
}

/** User-facing message when an immediate or scheduled publish fails. */
export function displayPublishErrorMessage(message: string): string {
  const trimmed = (message || '').trim();
  if (!trimmed) return 'Could not publish to Instagram.';
  if (isAccessTokenError(trimmed)) {
    return `${TOKEN_UPDATE_NOTE}. Open Accounts → credentials → Connect Instagram API to refresh the token.`;
  }
  return trimmed;
}

/** Pull the raw failure message from a scheduled post before it is marked skipped. */
export function resolveSkipNoteText(post: {
  skipReason?: string;
  postError?: string;
}): string {
  if (post.skipReason?.trim()) return post.skipReason;
  if (post.postError?.trim() && post.postError !== SCHEDULE_ERROR_LABEL) return post.postError;
  return 'Scheduled post failed';
}
