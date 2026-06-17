import { relayThroughProxy } from './bskyProxy.js';

/** Node fetch that tunnels HTTPS through the Bluesky proxy relay (binary-safe). */
export function makeRelayFetch(proxy) {
  return async (input, init) => {
    const req = new Request(input, init);
    const method = req.method || 'GET';
    const headers = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });

    let body = null;
    let bodyEncoding;
    if (method !== 'GET' && method !== 'HEAD') {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > 0) {
        body = buf.toString('base64');
        bodyEncoding = 'base64';
      }
    }

    const data = await relayThroughProxy({
      url: req.url,
      method,
      headers,
      body,
      bodyEncoding,
      proxy,
    });

    const responseBody =
      data.bodyEncoding === 'base64'
        ? Buffer.from(data.body || '', 'base64')
        : data.body ?? '';

    return new Response(responseBody, { status: data.status, headers: data.headers });
  };
}
