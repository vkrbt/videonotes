const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Ограниченный диапазон не буферизует фильм и укладывается в лимит ответа Vercel.
const MAX_CHUNK = 4 * 1024 * 1024;
function mediaRange(value) {
  if (!value) return `bytes=0-${MAX_CHUNK - 1}`;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Number(match[2]);
    return Number.isSafeInteger(length) && length > 0 ? `bytes=-${Math.min(length, MAX_CHUNK)}` : null;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start + MAX_CHUNK - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || start > Number.MAX_SAFE_INTEGER - MAX_CHUNK) return null;
  return `bytes=${start}-${Math.min(end, start + MAX_CHUNK - 1)}`;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    res.statusCode = 405;
    return res.end();
  }
  const query = new URL(req.url, 'https://videonotes.vkrbt.me').searchParams;
  const id = query.get('id');
  const resourceKey = query.get('resourcekey');
  const range = mediaRange(req.headers.range);
  if (!id || !/^[\w-]{10,200}$/.test(id) || (resourceKey && !/^[\w-]{1,200}$/.test(resourceKey))) {
    res.statusCode = 400;
    return res.end('Invalid Google Drive file ID');
  }
  if (!range) { res.statusCode = 416; return res.end(); }
  const url = new URL('https://drive.usercontent.google.com/download');
  url.searchParams.set('id', id);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', 't');
  if (resourceKey) url.searchParams.set('resourcekey', resourceKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const disconnect = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', disconnect);
  try {
    // Не передаём Origin, Referer, Sec-Fetch-* и cookies браузера: Drive блокирует внешние video-запросы.
    const upstream = await fetch(url, { headers: { Range: range }, signal: controller.signal });
    if (upstream.status === 416) {
      res.statusCode = 416;
      const total = upstream.headers.get('content-range');
      if (total && /^bytes \*\/\d+$/.test(total)) res.setHeader('Content-Range', total);
      await upstream.body?.cancel();
      return res.end();
    }
    const contentType = upstream.headers.get('content-type') || '';
    const contentRange = upstream.headers.get('content-range') || '';
    const bounds = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    const length = bounds ? Number(bounds[2]) - Number(bounds[1]) + 1 : 0;
    if (upstream.status !== 206 || !/^(video\/|application\/octet-stream)/i.test(contentType) || !bounds || length <= 0 || length > MAX_CHUNK) {
      await upstream.body?.cancel();
      res.statusCode = [401, 403, 404, 429].includes(upstream.status) ? upstream.status : 502;
      return res.end('Google Drive did not return a video stream');
    }
    res.statusCode = 206;
    res.setHeader('Content-Type', contentType.split(';')[0]);
    res.setHeader('Content-Range', contentRange);
    res.setHeader('Content-Length', String(length));
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.method === 'HEAD') {
      await upstream.body?.cancel();
      return res.end();
    }
    await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
  } catch {
    if (!res.headersSent) { res.statusCode = 502; res.end('Google Drive is unavailable'); }
    else res.destroy();
  } finally {
    clearTimeout(timeout);
    res.off('close', disconnect);
  }
}
module.exports = handler;
module.exports.mediaRange = mediaRange;
