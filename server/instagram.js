// Instagram data is fetched from Apify Actors (https://apify.com) and normalized
// into the field names the frontend parser (src/lib/parse.ts) already understands,
// so the rest of the app keeps working unchanged.

// Profile data — returns followersCount, followsCount, postsCount, etc.
export const APIFY_PROFILE_ACTOR = 'dSCLg0C3YEZ83HzYX';
// Post data — returns posts/reels with view_count, like_count, comment_count, etc.
export const APIFY_POSTS_ACTOR = 'pmQcv69sB1UwguQUY';

const POSTS_PER_PROFILE = 12;

const INVALID_TOKENS = new Set([
  '',
  'undefined',
  'null',
  'your_apify_token_here',
  '<your_api_token>',
  'your_actual_token',
]);

export function normalizeUsername(username) {
  return username.trim().replace(/^@/, '').toLowerCase();
}

export function hasValidApiKey() {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return false;
  return !INVALID_TOKENS.has(token.toLowerCase());
}

function extractApifyError(data, status) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const err = data.error;
    const message =
      (err && typeof err === 'object' && err.message) ||
      (typeof err === 'string' && err) ||
      data.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `Apify request failed (${status})`;
}

async function runActorSync(actorId, input) {
  if (!hasValidApiKey()) {
    throw new Error(
      'APIFY_TOKEN is missing or invalid. Add your Apify API token in Vercel Environment Variables.',
    );
  }

  const token = process.env.APIFY_TOKEN.trim();
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(extractApifyError(data, response.status));
  }

  if (Array.isArray(data)) return data;

  // A non-array response usually means the run errored.
  const message = extractApifyError(data, response.status);
  throw new Error(message);
}

export async function fetchInstagramProfile(username) {
  const normalized = normalizeUsername(username);
  const items = await runActorSync(APIFY_PROFILE_ACTOR, {
    usernames: [normalized],
    includeAboutSection: false,
  });

  const profile =
    items.find((item) => item && (item.username || item.followersCount != null)) || items[0];

  if (!profile || (profile.error && profile.followersCount == null)) {
    throw new Error(`@${normalized} was not found or the account is private.`);
  }

  // Emit a RapidAPI-compatible shape so src/lib/parse.ts maps it without changes.
  return {
    data: {
      user: {
        username: String(profile.username || normalized).toLowerCase(),
        full_name: profile.fullName ?? '',
        biography: profile.biography ?? '',
        profile_pic_url_hd: profile.profilePicUrlHD ?? profile.profilePicUrl ?? '',
        profile_pic_url: profile.profilePicUrl ?? '',
        follower_count: profile.followersCount ?? 0,
        following_count: profile.followsCount ?? 0,
        media_count: profile.postsCount ?? 0,
        is_verified: Boolean(profile.verified),
      },
    },
  };
}

function isReel(post) {
  if (!post || typeof post !== 'object') return false;
  return (
    post.product_type === 'clips' ||
    post.type === 'Video' ||
    Array.isArray(post.video_versions) ||
    post.view_count != null ||
    post.video_duration != null
  );
}

export async function fetchInstagramReels(username) {
  const normalized = normalizeUsername(username);
  const posts = await runActorSync(APIFY_POSTS_ACTOR, {
    instagramUsernames: [normalized],
    postsPerProfile: POSTS_PER_PROFILE,
  });

  const items = posts.filter(isReel).map((post) => {
    const caption =
      typeof post.caption === 'string'
        ? post.caption
        : (post.caption && typeof post.caption === 'object' ? post.caption.text : '') || '';

    const takenAt = post.date ? Math.floor(Date.parse(post.date) / 1000) : undefined;

    return {
      pk: String(post.pk ?? post.id ?? post.shortcode ?? ''),
      id: String(post.id ?? post.pk ?? post.shortcode ?? ''),
      shortcode: post.shortcode ?? post.code ?? '',
      caption,
      thumbnail_url:
        post.image ??
        (Array.isArray(post.images) ? post.images?.[0]?.url : undefined) ??
        post.display_url ??
        '',
      play_count: post.view_count ?? post.play_count ?? 0,
      view_count: post.view_count ?? 0,
      like_count: post.like_count ?? 0,
      comment_count: post.comment_count ?? 0,
      taken_at: Number.isFinite(takenAt) ? takenAt : undefined,
    };
  });

  return { items };
}

export async function fetchInstagramStories() {
  // The configured Apify Actors do not provide stories; return an empty set so
  // the frontend gracefully shows no stories instead of erroring.
  return { items: [] };
}
