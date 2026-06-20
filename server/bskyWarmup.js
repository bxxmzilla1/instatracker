import { AtpAgent } from '@atproto/api';
import { makeRelayFetch } from './bskyRelayFetch.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function interruptibleSleep(ms, shouldCancel) {
  let remaining = ms;
  while (remaining > 0) {
    if (shouldCancel()) return;
    const slice = Math.min(1000, remaining);
    await sleep(slice);
    remaining -= slice;
  }
}

export const WARMUP_SESSION_MS = 5 * 60 * 1000;

const SIGN_IN_TIMEOUT_MS = 90 * 1000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const WARMUP_PLAN = [
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

function parseError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.error && err.message) return `${err.error}: ${err.message}`;
  return err.message || String(err);
}

function isPostView(v) {
  return Boolean(v && typeof v === 'object' && v.uri && v.cid);
}

function pickRandom(items) {
  if (!items.length) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function collectThreadPosts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (isPostView(node.post)) {
    const author = node.post.author;
    out.push({ uri: node.post.uri, cid: node.post.cid, handle: author?.handle });
  }
  for (const reply of node.replies ?? []) collectThreadPosts(reply, out);
  return out;
}

async function fetchTimelinePosts(agent, limit = 30) {
  const res = await agent.app.bsky.feed.getTimeline({ limit });
  return (res.data.feed ?? [])
    .map((item) => item.post)
    .filter(isPostView)
    .map((post) => ({
      uri: post.uri,
      cid: post.cid,
      handle: post.author?.handle,
    }));
}

async function scrollTimeline(agent, durationMs, shouldCancel) {
  const started = Date.now();
  let cursor;
  while (Date.now() - started < durationMs) {
    if (shouldCancel()) return;
    const res = await agent.app.bsky.feed.getTimeline({ limit: 30, cursor });
    cursor = res.data.cursor;
    await interruptibleSleep(Math.min(4000, durationMs - (Date.now() - started)), shouldCancel);
    if (!cursor) break;
  }
  const remaining = durationMs - (Date.now() - started);
  if (remaining > 0) await interruptibleSleep(remaining, shouldCancel);
}

async function browseAuthorFeed(agent, actor, durationMs, shouldCancel) {
  const started = Date.now();
  let cursor;
  while (Date.now() - started < durationMs) {
    if (shouldCancel()) return;
    const res = await agent.app.bsky.feed.getAuthorFeed({ actor, limit: 30, cursor });
    cursor = res.data.cursor;
    await interruptibleSleep(Math.min(4000, durationMs - (Date.now() - started)), shouldCancel);
    if (!cursor) break;
  }
  const remaining = durationMs - (Date.now() - started);
  if (remaining > 0) await interruptibleSleep(remaining, shouldCancel);
}

async function likePost(agent, post) {
  if (!post?.uri || !post?.cid) return;
  try {
    await agent.like(post.uri, post.cid);
  } catch (err) {
    const msg = parseError(err);
    if (!/already|exists|duplicate/i.test(msg)) throw err;
  }
}

async function postReply(agent, root, parent, text) {
  await agent.post({
    text,
    reply: {
      root: { uri: root.uri, cid: root.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    },
    createdAt: new Date().toISOString(),
  });
}

async function loginAgent(credentials) {
  const { identifier, password, service, proxy } = credentials;
  if (!identifier?.trim() || !password?.trim()) {
    throw new Error('Missing handle/email or app password.');
  }
  const agent = new AtpAgent({
    service: (service && service.trim()) || 'https://bsky.social',
    ...(proxy ? { fetch: makeRelayFetch(proxy) } : {}),
  });
  await agent.login({ identifier: identifier.trim(), password: password.trim() });
  return agent;
}

export async function runAccountWarmup(credentials, hooks = {}, options = {}) {
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
    const agent = await withTimeout(
      loginAgent(credentials),
      SIGN_IN_TIMEOUT_MS,
      'Sign-in timed out — check the account proxy or app password.',
    );

    let timeline = await withTimeout(
      fetchTimelinePosts(agent),
      SIGN_IN_TIMEOUT_MS,
      'Loading the timeline timed out after sign-in.',
    );
    let threadPosts = [];
    let lastProfileHandle;

    for (let i = startIdx; i < WARMUP_PLAN.length; i++) {
      if (shouldCancel()) return { ok: true, cancelled: true };

      const action = WARMUP_PLAN[i];
      onProgress({ step: i + 1, totalSteps, label: action.label });

      if (timeline.length === 0) timeline = await fetchTimelinePosts(agent);

      switch (action.type) {
        case 'scroll_feed':
          await scrollTimeline(agent, action.durationMs, shouldCancel);
          timeline = await fetchTimelinePosts(agent);
          break;
        case 'like_post': {
          const post = pickRandom(timeline);
          if (post) await likePost(agent, post);
          await interruptibleSleep(action.durationMs, shouldCancel);
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
              await likePost(agent, root);
            }
          }
          await interruptibleSleep(action.durationMs, shouldCancel);
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
          await interruptibleSleep(action.durationMs, shouldCancel);
          break;
        }
        case 'open_profile': {
          const post = pickRandom(timeline);
          const handle = post?.handle ?? lastProfileHandle;
          if (handle) {
            await agent.app.bsky.actor.getProfile({ actor: handle });
            lastProfileHandle = handle;
          }
          await interruptibleSleep(action.durationMs, shouldCancel);
          break;
        }
        case 'browse_feed': {
          const handle = lastProfileHandle ?? pickRandom(timeline)?.handle;
          if (handle) {
            lastProfileHandle = handle;
            await browseAuthorFeed(agent, handle, action.durationMs, shouldCancel);
          } else {
            await interruptibleSleep(action.durationMs, shouldCancel);
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
          await interruptibleSleep(action.durationMs, shouldCancel);
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
          await interruptibleSleep(action.durationMs, shouldCancel);
          break;
        }
        default:
          await interruptibleSleep(action.durationMs, shouldCancel);
      }
    }

    const elapsed = Date.now() - sessionStart;
    if (elapsed < WARMUP_SESSION_MS) {
      onProgress({ step: totalSteps, totalSteps, label: 'Finishing session…' });
      await interruptibleSleep(WARMUP_SESSION_MS - elapsed, shouldCancel);
      if (shouldCancel()) return { ok: true, cancelled: true };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: parseError(err) };
  }
}
