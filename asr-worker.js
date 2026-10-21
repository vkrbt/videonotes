/* Расшифровка речи в браузере: Whisper через transformers.js, слова с таймингами.
   Модуль-воркер, чтобы распознавание не подвешивало страницу. Модель качается один раз
   и дальше лежит в кеше браузера; звук никуда не отправляется.
   Звук режется на куски ≈45 с по тишине. Первым идёт кусок с текущим моментом, дальше — к концу,
   потом начало. Перемотал во время распознавания — следующим берётся кусок у нового места. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;

const MODELS = {
  small: 'onnx-community/whisper-small_timestamped',
  turbo: 'onnx-community/whisper-large-v3-turbo_timestamped',
};
const RATE = 16000;
const PART = 45 * RATE;
const SEEK = 4 * RATE;           // границу куска ищем в тишине в пределах ±4 с
const PAD = Math.round(0.4 * RATE); // Whisper теряет крайние слова — по краям куска немного тишины

let asr = null;
let loaded = null;
let focus = 0;                   // секунда, с которой брать следующий кусок
let stopped = false;

async function device() {
  if (!navigator.gpu) return { device: 'wasm', f16: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { device: 'wasm', f16: false };
    return { device: 'webgpu', f16: adapter.features.has('shader-f16') };
  } catch {
    return { device: 'wasm', f16: false };
  }
}

async function load(model) {
  if (asr && loaded === model) { postMessage({ type: 'ready' }); return; }
  const d = await device();
  const dtype = d.device === 'webgpu'
    ? { encoder_model: d.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', MODELS[model] || MODELS.small, {
    device: d.device,
    dtype,
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let a = 0, b = 0;
      for (const [x, y] of files.values()) { a += x; b += y; }
      postMessage({ type: 'download', loaded: a, total: b });
    },
  });
  loaded = model;
  postMessage({ type: 'ready', device: d.device });
}

// Граница куска — в самом тихом месте рядом с целевой точкой, чтобы не резать слово
function cutAt(audio, target) {
  if (target >= audio.length) return audio.length;
  const win = RATE / 10;
  let best = target, bestE = Infinity;
  for (let c = Math.max(win, target - SEEK); c < Math.min(audio.length - win, target + SEEK); c += win / 2) {
    let e = 0;
    for (let i = c - win / 2; i < c + win / 2; i++) e += audio[i] * audio[i];
    if (e < bestE) { bestE = e; best = c; }
  }
  return Math.round(best);
}

async function run({ audio, model, language, from = 0, skip = [] }) {
  stopped = false;
  focus = from;
  await load(model);
  const parts = [];
  for (let s = 0; s < audio.length;) {
    const e = cutAt(audio, s + PART);
    const a = s / RATE, b = e / RATE;
    parts.push({ s, e, done: skip.some(([x, y]) => x <= a + 0.05 && y >= b - 0.05) });
    s = e;
  }
  const total = parts.length;
  for (;;) {
    if (stopped) return;
    const next = parts.find((p) => !p.done && p.e / RATE > focus) || parts.find((p) => !p.done);
    if (!next) break;
    const piece = new Float32Array(next.e - next.s + PAD * 2);
    piece.set(audio.subarray(next.s, next.e), PAD);
    const out = await asr(piece, {
      ...(language ? { language } : {}),   // без языка Whisper определит его сам
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    next.done = true;
    const a = next.s / RATE, b = next.e / RATE;
    const offset = a - PAD / RATE;
    const words = (out.chunks || [])
      .map((c) => {
        const s = (c.timestamp?.[0] ?? 0) + offset;
        const e = (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) + offset;
        return { w: String(c.text || '').trim(), s: Math.round(Math.max(a, s) * 1000) / 1000, e: Math.round(Math.min(b, Math.max(s, e)) * 1000) / 1000 };
      })
      .filter((x) => x.w);
    postMessage({ type: 'words', words, range: [a, b], done: parts.filter((p) => p.done).length / total });
  }
  postMessage({ type: 'done' });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'focus') { focus = m.t; return; }
  if (m.type === 'stop') { stopped = true; return; }
  try {
    if (m.type === 'run') await run(m);
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
