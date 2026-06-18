/**
 * Verifies Graph relay POST bodies for direct vs proxied requests (no network call).
 * Run: node scripts/verify-graph-relay.mjs
 */

import https from 'https';
import { relayGraphRequest } from '../server/graph.js';

const sampleCaption = 'Test caption 🎬\n#line2 #hashtag @user';

function mockFetch() {
  globalThis.fetch = async (url, init) => {
    globalThis.lastDirectRequest = { url: url.toString(), init: { ...init, body: init.body } };
    return {
      status: 200,
      ok: true,
      json: async () => ({ id: 'TEST_CONTAINER' }),
    };
  };
}

function mockHttpsRequest() {
  https.request = (options, callback) => {
    const req = {
      on(event, handler) {
        if (event === 'timeout') return this;
        if (event === 'error') return this;
        return this;
      },
      end(body) {
        globalThis.lastProxyRequest = {
          url: `${options.protocol}//${options.hostname}${options.path}`,
          init: {
            method: options.method,
            headers: options.headers,
            body,
          },
        };
        callback({
          statusCode: 200,
          on(event, handler) {
            if (event === 'data') return this;
            if (event === 'end') handler();
            return this;
          },
        });
      },
    };
    return req;
  };
}

async function runCase(label, payload, inspect) {
  globalThis.lastDirectRequest = null;
  globalThis.lastProxyRequest = null;
  const { status, data } = await relayGraphRequest(payload);
  if (status !== 200 || data?.id !== 'TEST_CONTAINER') {
    console.error(`${label}: unexpected relay response`, { status, data });
    process.exit(1);
  }
  const ok = inspect();
  console.log(`${label}: ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) process.exit(1);
}

mockFetch();
await runCase(
  'Direct (no proxy)',
  {
    method: 'POST',
    path: '/123/media',
    accessToken: 'TEST_TOKEN',
    params: {
      media_type: 'REELS',
      video_url: 'https://example.com/video.mp4',
      caption: sampleCaption,
    },
  },
  () => {
    const body = globalThis.lastDirectRequest?.init?.body ?? '';
    return (
      globalThis.lastDirectRequest?.init?.headers?.['Content-Type'] ===
        'application/x-www-form-urlencoded' &&
      body.includes('caption=') &&
      body.includes('access_token=TEST_TOKEN') &&
      !globalThis.lastDirectRequest.url.includes('caption=')
    );
  },
);

mockHttpsRequest();
await runCase(
  'Proxied (scheduled)',
  {
    method: 'POST',
    path: '/123/media',
    accessToken: 'TEST_TOKEN',
    proxy: { type: 'http', host: '127.0.0.1', port: '8080' },
    params: {
      media_type: 'REELS',
      video_url: 'https://example.com/video.mp4',
      caption: sampleCaption,
    },
  },
  () => {
    const body = globalThis.lastProxyRequest?.init?.body ?? '';
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
    return (
      globalThis.lastProxyRequest?.init?.headers?.['Content-Type'] === 'application/json' &&
      parsed.caption === sampleCaption &&
      parsed.media_type === 'REELS' &&
      !globalThis.lastProxyRequest.url.includes('caption=')
    );
  },
);

console.log('\nGraph relay POST formats: OK');
