export const TOKEN_UPDATE_NOTE = 'API token needs to be updated';

/** True when Instagram rejected the request because the Graph API token is invalid or expired. */
export function isAccessTokenError(message: string): boolean {
  return /validating access token|invalid access token|access token has expired|session has been invalidated|log in to www\.instagram\.com|OAuthException/i.test(
    message,
  );
}
