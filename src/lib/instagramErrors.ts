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

/** Note text saved when a scheduled publish fails for an account. */
export function noteTextForPublishError(message: string): string {
  if (isAccessTokenError(message)) return TOKEN_UPDATE_NOTE;
  const trimmed = message.trim();
  return trimmed || 'Scheduled post failed';
}
