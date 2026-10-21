/* Звук из MP4/MOV кусками, без ffmpeg и без чтения всего файла.
   Читаем только индекс (moov) — обычно меньше мегабайта, даже у файла на 7 ГБ, — и по нему
   для нужного отрезка времени достаём из файла ровно байты звука. Несжатый PCM переводим в 16 кГц
   сами, AAC декодирует встроенный в браузер WebCodecs. В памяти — только текущий кусок. */

const RATE = 16000;
const MAX_MOOV = 64e6;

async function bytes(file, a, b) {
  return new Uint8Array(await file.slice(a, b).arrayBuffer());
}

// Верхние боксы файла: читаем только заголовки, mdat на гигабайты перепрыгиваем
async function findMoov(file) {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await bytes(file, pos, Math.min(file.size, pos + 16));
    const v = new DataView(h.buffer);
    let size = v.getUint32(0);
    const type = String.fromCharCode(...h.subarray(4, 8));
    if (size === 1) size = Number(v.getBigUint64(8));
    else if (size === 0) size = file.size - pos;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > MAX_MOOV) throw new Error('moov too big');
      return bytes(file, pos, pos + size);
    }
    pos += size;
  }
  throw new Error('no moov');
}

function* boxes(buf, start, end) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = start;
  while (p + 8 <= end) {
    let size = v.getUint32(p), hdr = 8;
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    if (size === 1) { size = Number(v.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) return;
    yield { type, start: p, body: p + hdr, end: p + size };
    p += size;
  }
}

function child(buf, box, type) {
  for (const b of boxes(buf, box.body, box.end)) if (b.type === type) return b;
  return null;
}

function path(buf, box, ...types) {
  let b = box;
  for (const t of types) { b = b && child(buf, b, t); }
  return b;
}

// esds → AudioSpecificConfig (описание для AudioDecoder)
function esdsConfig(buf, esds) {
  let p = esds.body + 4;
  const readLen = () => { let n = 0, c; do { c = buf[p++]; n = (n << 7) | (c & 0x7f); } while (c & 0x80 && p < esds.end); return n; };
  while (p < esds.end) {
    const tag = buf[p++]; const len = readLen();
    if (tag === 0x03) { p += 3; continue; }                 // ES_Descriptor: id + flags
    if (tag === 0x04) { p += 13; continue; }                // DecoderConfigDescriptor
    if (tag === 0x05) return buf.slice(p, p + len);         // DecoderSpecificInfo
    p += len;
  }
  return null;
}

function parseAudioTrack(moov) {
  const root = { body: 0, end: moov.length };
  const v = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (const trak of boxes(moov, 8, moov.length)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (!hdlr || String.fromCharCode(...moov.subarray(hdlr.body + 8, hdlr.body + 12)) !== 'soun') continue;
    const mdhd = child(moov, mdia, 'mdhd');
    const timescale = moov[mdhd.body] === 1 ? v.getUint32(mdhd.body + 20) : v.getUint32(mdhd.body + 12);
    const stbl = path(moov, mdia, 'minf', 'stbl');
    const stsd = child(moov, stbl, 'stsd');
    const entry = stsd.body + 8;                              // первый sample entry
    const format = String.fromCharCode(...moov.subarray(entry + 4, entry + 8));
    const ver = v.getUint16(entry + 16);                      // версия звукового описания QuickTime
    let channels = v.getUint16(entry + 24), bits = v.getUint16(entry + 26);
    let sampleRate = v.getUint32(entry + 32) / 65536;
    let bytesPerFrame = 0, float = false, little = format === 'sowt', signed = format !== 'raw ';
    let extStart = entry + 36;
    if (ver === 1) {
      bytesPerFrame = v.getUint32(entry + 44);
      extStart = entry + 52;
    } else if (ver === 2) {
      sampleRate = v.getFloat64(entry + 40);
      channels = v.getUint32(entry + 48);
      bits = v.getUint32(entry + 56);
      const flags = v.getUint32(entry + 60);
      bytesPerFrame = v.getUint32(entry + 64);
      float = !!(flags & 1);
      little = !(flags & 2);
      signed = !!(flags & 4) || float;
      extStart = entry + 72;
    }
    const entryEnd = entry + v.getUint32(entry);
    let config = null;
    for (const b of boxes(moov, extStart, entryEnd)) {
      if (b.type === 'esds') config = esdsConfig(moov, b);
      if (b.type === 'wave') {
        for (const w of boxes(moov, b.body, b.end)) {
          if (w.type === 'esds') config = esdsConfig(moov, w);
          if (w.type === 'enda') little = v.getUint16(w.body) === 1;
        }
      }
      if (b.type === 'enda') little = v.getUint16(b.body) === 1;
    }
    if (format === 'in24') bits = 24;
    if (format === 'in32') bits = 32;
    if (format === 'fl32') { bits = 32; float = true; }
    if (format === 'fl64') { bits = 64; float = true; }
    if (format === 'twos' || format === 'sowt') bits = bits || 16;

    // Таблица кусков: смещение в файле, номер первого сэмпла, сколько сэмплов
    const stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64');
    const co64 = stco.type === 'co64';
    const nChunks = v.getUint32(stco.body + 4);
    const offsets = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) offsets[i] = co64 ? Number(v.getBigUint64(stco.body + 8 + i * 8)) : v.getUint32(stco.body + 8 + i * 4);
    const stsc = child(moov, stbl, 'stsc');
    const nStsc = v.getUint32(stsc.body + 4);
    const perChunk = new Uint32Array(nChunks);
    for (let k = 0; k < nStsc; k++) {
      const first = v.getUint32(stsc.body + 8 + k * 12) - 1;
      const count = v.getUint32(stsc.body + 12 + k * 12);
      const next = k + 1 < nStsc ? v.getUint32(stsc.body + 8 + (k + 1) * 12) - 1 : nChunks;
      for (let c = first; c < next && c < nChunks; c++) perChunk[c] = count;
    }
    const firstSample = new Float64Array(nChunks + 1);
    for (let c = 0; c < nChunks; c++) firstSample[c + 1] = firstSample[c] + perChunk[c];

    const stsz = child(moov, stbl, 'stsz');
    const fixedSize = stsz ? v.getUint32(stsz.body + 4) : 0;
    const nSamples = stsz ? v.getUint32(stsz.body + 8) : 0;
    let sizes = null;
    if (stsz && !fixedSize) {
      sizes = new Uint32Array(nSamples);
      for (let i = 0; i < nSamples; i++) sizes[i] = v.getUint32(stsz.body + 12 + i * 4);
    }
    // stts: длительность сэмплов в единицах timescale
    const stts = child(moov, stbl, 'stts');
    const nStts = v.getUint32(stts.body + 4);
    const sttsRuns = [];
    for (let k = 0; k < nStts; k++) sttsRuns.push([v.getUint32(stts.body + 8 + k * 8), v.getUint32(stts.body + 12 + k * 8)]);

    const pcm = ['lpcm', 'in24', 'in32', 'fl32', 'fl64', 'twos', 'sowt', 'raw '].includes(format);
    return { format, pcm, channels, bits, sampleRate, bytesPerFrame: bytesPerFrame || (channels * bits) / 8, float, little, signed,
      timescale, offsets, perChunk, firstSample, fixedSize, sizes, sttsRuns, config };
  }
  throw new Error('no audio track');
}

// Номер куска таблицы, где лежит сэмпл s
function chunkOf(t, s) {
  let lo = 0, hi = t.offsets.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t.firstSample[m] <= s) lo = m; else hi = m - 1; }
  return lo;
}

// Несжатый звук: кадры [f0, f1) → моно Float32 в исходной частоте
async function readPcm(file, t, f0, f1) {
  const bpf = t.bytesPerFrame, ch = t.channels, bps = bpf / ch;
  const out = new Float32Array(Math.max(0, f1 - f0));
  // В PCM-дорожке «сэмпл» таблицы — один кадр звука (или байт, если stsz = 1)
  const unit = t.fixedSize === 1 && bpf > 1 ? 1 / bpf : 1;
  let o = 0, f = f0;
  while (f < f1) {
    const s = Math.floor(f / unit);
    const c = chunkOf(t, s);
    const chunkFrames = t.perChunk[c] * unit;
    const inChunk = f - t.firstSample[c] * unit;
    const n = Math.min(f1 - f, chunkFrames - inChunk);
    if (n <= 0) break;
    const start = t.offsets[c] + inChunk * bpf;
    const buf = await bytes(file, start, start + n * bpf);
    const v = new DataView(buf.buffer);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < ch; k++) {
        const p = i * bpf + k * bps;
        let x;
        if (t.float) x = bps === 8 ? v.getFloat64(p, t.little) : v.getFloat32(p, t.little);
        else if (bps === 2) x = v.getInt16(p, t.little) / 32768;
        else if (bps === 3) { const b0 = buf[p], b1 = buf[p + 1], b2 = buf[p + 2]; let n24 = t.little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2; if (n24 & 0x800000) n24 -= 0x1000000; x = n24 / 8388608; }
        else if (bps === 4) x = v.getInt32(p, t.little) / 2147483648;
        else x = (buf[p] - 128) / 128;
        sum += x;
      }
      out[o++] = sum / ch;
    }
    f += n;
  }
  return out;
}

// Простой и честный ресемплинг: усреднение окна (для речи достаточно, памяти — ноль)
function resample(src, from) {
  if (from === RATE) return src;
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(src.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += src[k];
    out[i] = b > a ? s / (b - a) : src[a] || 0;
  }
  return out;
}

// Сжатый звук (AAC и др.): сэмплы — кадры кодека; декодирует WebCodecs
async function readCoded(file, t, a, b) {
  if (typeof AudioDecoder === 'undefined') throw new Error('no AudioDecoder');
  // время сэмпла по stts
  const times = [];
  let tsum = 0, idx = 0;
  const startTs = a * t.timescale, endTs = b * t.timescale;
  let s0 = -1, s1 = -1;
  for (const [count, delta] of t.sttsRuns) {
    if (s1 >= 0) break;
    if (tsum + count * delta < startTs) { tsum += count * delta; idx += count; continue; }
    for (let k = 0; k < count; k++, idx++, tsum += delta) {
      if (s0 < 0 && tsum + delta > startTs) s0 = idx;
      if (tsum >= endTs) { s1 = idx; break; }
      if (s0 >= 0) times.push(tsum);
    }
  }
  if (s0 < 0) return new Float32Array(0);
  if (s1 < 0) s1 = s0 + times.length;
  const size = (i) => (t.sizes ? t.sizes[i] : t.fixedSize);
  const pcmParts = [];
  let rate = 0, decodeError = null;
  const dec = new AudioDecoder({
    output: (d) => {
      rate = d.sampleRate;
      const n = d.numberOfFrames, mono = new Float32Array(n), tmp = new Float32Array(n);
      for (let k = 0; k < d.numberOfChannels; k++) {
        d.copyTo(tmp, { planeIndex: k, format: 'f32-planar' });
        for (let i = 0; i < n; i++) mono[i] += tmp[i] / d.numberOfChannels;
      }
      pcmParts.push(mono);
      d.close();
    },
    error: (e) => { decodeError = e; },
  });
  const codec = t.format === 'mp4a' ? `mp4a.40.${t.config ? (t.config[0] >> 3) : 2}` : t.format;
  dec.configure({ codec, sampleRate: t.sampleRate, numberOfChannels: t.channels, ...(t.config ? { description: t.config } : {}) });
  // читаем по кускам таблицы: внутри куска сэмплы лежат подряд
  let s = s0;
  while (s < s1) {
    const c = chunkOf(t, s);
    let off = t.offsets[c];
    for (let k = t.firstSample[c]; k < s; k++) off += size(k);
    const last = Math.min(s1, t.firstSample[c + 1]);
    let len = 0;
    for (let k = s; k < last; k++) len += size(k);
    const buf = await bytes(file, off, off + len);
    let p = 0;
    for (let k = s; k < last; k++) {
      const n = size(k);
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((times[k - s0] / t.timescale) * 1e6), data: buf.subarray(p, p + n) }));
      p += n;
    }
    s = last;
  }
  await dec.flush();
  dec.close();
  if (decodeError) throw decodeError;
  const total = pcmParts.reduce((n, x) => n + x.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const x of pcmParts) { all.set(x, o); o += x.length; }
  return resample(all, rate || t.sampleRate);
}

// Источник звука для расшифровки: part(a, b) → Float32Array 16 кГц моно
export async function mp4Source(file) {
  const moov = await findMoov(file);
  const t = parseAudioTrack(moov);
  if (!t.pcm && !(t.format === 'mp4a' && t.config)) throw new Error('unsupported audio ' + t.format);
  return {
    info: { format: t.format, channels: t.channels, sampleRate: t.sampleRate, bits: t.bits },
    async part(a, b) {
      if (t.pcm) {
        const f0 = Math.max(0, Math.floor(a * t.sampleRate)), f1 = Math.floor(b * t.sampleRate);
        return resample(await readPcm(file, t, f0, f1), t.sampleRate);
      }
      return readCoded(file, t, a, b);
    },
    close() {},
  };
}
