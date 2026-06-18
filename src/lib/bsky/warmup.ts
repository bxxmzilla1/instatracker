import type { AtpAgent } from '@atproto/api';
import { loginBskyAgent, parseError, type BskyCredentials } from './client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Total session length (~5 minutes). */
export const WARMUP_SESSION_MS = 5 * 60 * 1000;

export interface WarmupProgress {
  step: number;
  totalSteps: number;
  label: string;
}

type WarmupAction =
  | 'scroll_feed'
  | 'like_post'
  | 'like_comment'
  | 'read_thread'
  | 'open_profile'
  | 'browse_feed'
  | 'post_comment'
  | 'reply_comment';

interface PostRef {
  uri: string;
  cid: string;
  handle?: string;
}

/** Ordered warm-up script matching the requested 5-minute activity mix. */
const WARMUP_PLAN: { type: WarmupAction; durationMs: number; label: string }[] = [
  { type: 'scroll_feed', durationMs: 20000, label: 'Scrolling feed…' },
  { type: 'like_post', durationMs: 2000, label: 'Liking a post…' },
  { type: 'like_post', durationMs: 2000, label: 'Liking a post…' },
  { type: 'scroll_feed', durationMs: 20000, label: 'Scrolling feed…' },
  { type: 'read_thread', durationMs: 35000, label: 'Reading a thread…' },
  { type: 'like_post', durationMs: 2000, label: 'Liking a post…' },
  { type: 'like_comment', durationMs: 2000, label: 'Liking a comment…' },
  { type: 'open_profile', durationMs: 5000, label: 'Opening a profile…' },
  { type: 'browse_feed', durationMs: 15000, label: 'Browsing profile feed…' },
  { type: 'like_comment', durationMs: 2000, label: 'Liking a comment…' },
  { type: 'scroll_feed', durationMs: 20000, label: 'Scrolling feed…' },
  { type: 'like_post', durationMs: 2000, label: 'Liking a post…' },
  { type: 'read_thread', durationMs: 35000, label: 'Reading a thread…' },
  { type: 'like_comment', durationMs: 2000, label: 'Liking a comment…' },
  { type: 'open_profile', durationMs: 5000, label: 'Opening a profile…' },
  { type: 'browse_feed', durationMs: 15000, label: 'Browsing profile feed…' },
  { type: 'post_comment', durationMs: 3000, label: 'Commenting on a post…' },
  { type: 'reply_comment', durationMs: 3000, label: 'Replying to a comment…' },
];

export const WARMUP_STEP_COUNT = WARMUP_PLAN.length;

const REPLY_TEXTS = ['Nice!', 'Love this', 'Great post', 'So good', '🔥', 'Interesting'];

function isPostView(v: unknown): v is PostRef {
  return Boolean(v && typeof v === 'object' && 'uri' in v && 'cid' in v);
}

function pickRandom<T>(items: T[]): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function collectThreadPosts(node: unknown, out: PostRef[] = []): PostRef[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { post?: unknown; replies?: unknown[] };
  if (isPostView(n.post)) {
    const author = (n.post as { author?: { handle?: string } }).author;
    out.push({ uri: n.post.uri, cid: n.post.cid, handle: author?.handle });
  }
  for (const reply of n.replies ?? []) collectThreadPosts(reply, out);
  return out;
}

async function fetchTimelinePosts(agent: AtpAgent, limit = 30): Promise<PostRef[]> {
  const res = await agent.app.bsky.feed.getTimeline({ limit });
  return (res.data.feed ?? [])
    .map((item) => item.post)
    .filter(isPostView)
    .map((post) => ({
      uri: post.uri,
      cid: post.cid,
      handle: (post as { author?: { handle?: string } }).author?.handle,
    }));
}

async function scrollTimeline(agent: AtpAgent, durationMs: number) {
  const started = Date.now();
  let cursor: string | undefined;
  while (Date.now() - started < durationMs) {
    const res = await agent.app.bsky.feed.getTimeline({ limit: 30, cursor });
    cursor = res.data.cursor;
    await sleep(Math.min(4000, durationMs - (Date.now() - started)));
    if (!cursor) break;
  }
  const remaining = durationMs - (Date.now() - started);
  if (remaining > 0) await sleep(remaining);
}

async function browseAuthorFeed(agent: AtpAgent, actor: string, durationMs: number) {
  const started = Date.now();
  let cursor: string | undefined;
  while (Date.now() - started < durationMs) {
    const res = await agent.app.bsky.feed.getAuthorFeed({ actor, limit: 30, cursor });
    cursor = res.data.cursor;
    await sleep(Math.min(4000, durationMs - (Date.now() - started)));
    if (!cursor) break;
  }
  const remaining = durationMs - (Date.now() - started);
  if (remaining > 0) await sleep(remaining);
}

async function likePost(agent: AtpAgent, post: PostRef) {
  if (!post.uri || !post.cid) return;
  try {
    await agent.like(post.uri, post.cid);
  } catch (err) {
    const msg = parseError(err);
    if (!/already|exists|duplicate/i.test(msg)) throw err;
  }
}

async function postReply(agent: AtpAgent, root: PostRef, parent: PostRef, text: string) {
  await agent.post({
    text,
    reply: {
      root: { uri: root.uri, cid: root.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    },
    createdAt: new Date().toISOString(),
  });
}

/**
 * Runs the full ~5-minute warm-up session for one Bluesky account.
 * Simulates feed scrolling, profile browsing, likes, reads, and replies.
 */
export async function runAccountWarmup(
  credentials: BskyCredentials,
  hooks: {
    onProgress?: (progress: WarmupProgress) => void;
    shouldCancel?: () => boolean;
  } = {},
  options: { startFromStepIndex?: number } = {},
): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
  const onProgress = hooks.onProgress ?? (() => {});
  const shouldCancel = hooks.shouldCancel ?? (() => false);
  const totalSteps = WARMUP_PLAN.length;
  const sessionStart = Date.now();
  const startIdx = Math.max(0, Math.min(options.startFromStepIndex ?? 0, WARMUP_PLAN.length));

  try {
    onProgress({
      step: startIdx,
      totalSteps,
      label: startIdx > 0 ? 'Resuming warm-up…' : 'Signing in…',
    });
    const agent = await loginBskyAgent(credentials);

    let timeline = await fetchTimelinePosts(agent);
    let threadPosts: PostRef[] = [];
    let lastProfileHandle: string | undefined;

    for (let i = startIdx; i < WARMUP_PLAN.length; i++) {
      if (shouldCancel()) return { ok: true, cancelled: true };

      const action = WARMUP_PLAN[i];
      onProgress({ step: i + 1, totalSteps, label: action.label });

      if (timeline.length === 0) timeline = await fetchTimelinePosts(agent);

      switch (action.type) {
        case 'scroll_feed': {
          await scrollTimeline(agent, action.durationMs);
          timeline = await fetchTimelinePosts(agent);
          break;
        }
        case 'like_post': {
          const post = pickRandom(timeline);
          if (post) await likePost(agent, post);
          await sleep(action.durationMs);
          break;
        }
        case 'like_comment': {
          const root = pickRandom(timeline);
          if (root) {
            try {
              const thread = await agent.app.bsky.feed.getPostThread({ uri: root.uri, depth: 6 });
              threadPosts = collectThreadPosts(thread.data.thread);
              const comments = threadPosts.filter((p) => p.uri !== root.uri);
              const comment = pickRandom(comments.length ? comments : threadPosts);
              if (comment) await likePost(agent, comment);
            } catch {
              // fall back to liking a timeline post
              await likePost(agent, root);
            }
          }
          await sleep(action.durationMs);
          break;
        }
        case 'read_thread': {
          const post = pickRandom(timeline);
          if (post) {
            try {
              const thread = await agent.app.bsky.feed.getPostThread({ uri: post.uri, depth: 8 });
              threadPosts = collectThreadPosts(thread.data.thread);
            } catch {
              threadPosts = [post];
            }
          }
          await sleep(action.durationMs);
          break;
        }
        case 'open_profile': {
          const post = pickRandom(timeline);
          const handle = post?.handle ?? lastProfileHandle;
          if (handle) {
            await agent.app.bsky.actor.getProfile({ actor: handle });
            lastProfileHandle = handle;
          }
          await sleep(action.durationMs);
          break;
        }
        case 'browse_feed': {
          const handle = lastProfileHandle ?? pickRandom(timeline)?.handle;
          if (handle) {
            lastProfileHandle = handle;
            await browseAuthorFeed(agent, handle, action.durationMs);
          } else {
            await sleep(action.durationMs);
          }
          break;
        }
        case 'post_comment': {
          const post = pickRandom(timeline);
          if (post) {
            try {
              await postReply(agent, post, post, pickRandom(REPLY_TEXTS) ?? 'Nice!');
            } catch {
              // non-fatal
            }
          }
          await sleep(action.durationMs);
          break;
        }
        case 'reply_comment': {
          const root = pickRandom(timeline);
          if (root) {
            try {
              if (threadPosts.length === 0) {
                const thread = await agent.app.bsky.feed.getPostThread({ uri: root.uri, depth: 8 });
                threadPosts = collectThreadPosts(thread.data.thread);
              }
              const comments = threadPosts.filter((p) => p.uri !== root.uri);
              const parent = pickRandom(comments.length ? comments : [root]);
              if (parent) {
                await postReply(agent, root, parent, pickRandom(REPLY_TEXTS) ?? 'Nice!');
              }
            } catch {
              // non-fatal
            }
          }
          await sleep(action.durationMs);
          break;
        }
        default:
          await sleep(action.durationMs);
      }
    }

    const elapsed = Date.now() - sessionStart;
    if (elapsed < WARMUP_SESSION_MS) {
      onProgress({ step: totalSteps, totalSteps, label: 'Finishing session…' });
      await sleep(WARMUP_SESSION_MS - elapsed);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: parseError(err) };
  }
}
