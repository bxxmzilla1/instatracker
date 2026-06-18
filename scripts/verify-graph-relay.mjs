/**
 * Verifies Graph relay POST bodies include caption + access_token (no network call).
 * Run: node scripts/verify-graph-relay.mjs
 */

import { relayGraphRequest } from '../server/graph.js';

const sampleCaption = 'Test caption 🎬\n#line2 #hashtag @user';

// Patch fetch/https so we can inspect the outbound request without calling Meta.
let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url: url.toString(), init: { ...init, body: init.body } };
  return {
    status: 200,
    ok: true,
    json: async () => ({ id: 'TEST_CONTAINER' }),
  };
};

const { status, data } = await relayGraphRequest({
  method: 'POST',
  path: '/123/media',
  accessToken: 'TEST_TOKEN',
  params: {
    media_type: 'REELS',
    video_url: 'https://example.com/video.mp4',
    caption: sampleCaption,
  },
});

if (status !== 200 || data?.id !== 'TEST_CONTAINER') {
  console.error('Unexpected relay response', { status, data });
  process.exit(1);
}

const body = captured?.init?.body ?? '';
const url = captured?.url ?? '';

console.log('URL (token in query for proxy auth):', url.includes('access_token=TEST_TOKEN') ? 'OK' : 'MISSING', url);
console.log('Content-Type:', captured?.init?.headers?.['Content-Type']);
console.log('Body includes caption:', body.includes('caption=') ? 'OK' : 'MISSING');
console.log('Body includes access_token:', body.includes('access_token=TEST_TOKEN') ? 'OK' : 'MISSING');
console.log('Body includes encoded newline:', body.includes('%0A') || body.includes('line2') ? 'OK' : 'MISSING');
console.log('Caption NOT in URL query:', !url.includes('caption=') ? 'OK' : 'FAIL — caption in URL');

const allOk =
  url.includes('access_token=TEST_TOKEN') &&
  captured?.init?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded' &&
  body.includes('caption=') &&
  body.includes('access_token=TEST_TOKEN') &&
  !url.includes('caption=');

console.log(allOk ? '\nGraph relay POST format: OK' : '\nGraph relay POST format: FAILED');
process.exit(allOk ? 0 : 1);
