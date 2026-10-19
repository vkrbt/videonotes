const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const handler = require('./api/drive.js');
const id = '142Tl3fUhgOPWPvbl1JsNhxrP9RVJ1Goe';
class ResponseSink extends Writable {
  constructor() { super(); this.headers = {}; this.bytes = []; this.statusCode = 200; }
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }
  _write(chunk, _, done) { this.bytes.push(Buffer.from(chunk)); done(); }
}
async function request({ range, method = 'GET', query = `id=${id}` } = {}, upstream) {
  const original = global.fetch;
  let call;
  global.fetch = async (url, options) => { call = { url, options }; return upstream; };
  const res = new ResponseSink();
  try {
    await handler({ method, url: '/api/drive?' + query, headers: { range, origin: 'https://videonotes.vkrbt.me', 'sec-fetch-dest': 'video' } }, res);
    return { res, call };
  } finally { global.fetch = original; }
}

test('browser range requests are bounded; suffix and invalid ranges are handled', () => {
  assert.equal(handler.mediaRange('bytes=10-'), 'bytes=10-4194313');
  assert.equal(handler.mediaRange('bytes=0-999999999'), 'bytes=0-4194303');
  assert.equal(handler.mediaRange('bytes=-100'), 'bytes=-100');
  assert.equal(handler.mediaRange('bytes=0-1,3-4'), null);
  assert.equal(handler.mediaRange('bytes=20-10'), null);
});

test('video bytes, total size and CORS are returned without browser headers upstream', async () => {
  const upstream = new Response(new Uint8Array([0, 1, 2, 3]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/7593908571' } });
  const { res, call } = await request({ range: 'bytes=0-3', query: `id=${id}&resourcekey=0-test` }, upstream);
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-3/7593908571');
  assert.equal(res.headers['content-length'], '4');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.deepEqual(Buffer.concat(res.bytes), Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(call.options.headers, { Range: 'bytes=0-3' });
  assert.equal(call.url.hostname, 'drive.usercontent.google.com');
  assert.equal(call.url.searchParams.get('resourcekey'), '0-test');
});

test('HTML and upstream access errors never masquerade as playable video', async () => {
  for (const status of [200, 403, 429]) {
    const { res } = await request({}, new Response('Access denied', { status, headers: { 'content-type': 'text/html' } }));
    assert.equal(res.statusCode, status === 200 ? 502 : status);
  }
});

test('invalid IDs and multiple ranges do not make outgoing requests', async () => {
  assert.equal((await request({ query: 'id=invalid' })).call, undefined);
  assert.equal((await request({ range: 'bytes=1-2,3-4' })).res.statusCode, 416);
  assert.equal((await request({ method: 'POST' })).res.statusCode, 405);
});

test('HEAD responds with video metadata and no video body', async () => {
  const { res } = await request({ method: 'HEAD' }, new Response(new Uint8Array([1, 2]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1/100' } }));
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-length'], '2');
  assert.equal(res.bytes.length, 0);
});
