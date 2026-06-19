export const TOKEN_UPDATE_NOTE = 'API token needs to be updated';

export function isAccessTokenError(message) {
  return /validating access token|invalid access token|access token has expired|session has been invalidated|log in to www\.instagram\.com|OAuthException/i.test(
    message,
  );
}
