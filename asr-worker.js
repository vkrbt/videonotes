/* Расшифровка речи в браузере: Whisper через transformers.js, слова с таймингами.
   Модуль-воркер, чтобы распознавание не подвешивало страницу. Модель качается один раз
   и дальше лежит в кеше браузера; звук никуда не отправляется. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;

const MODELS = {
  small: 'onnx-community/whisper-small_timestamped',
  turbo: 'onnx-community/whisper-large-v3-turbo_timestamped',
};
const RATE = 16000;
const PART = 300 * RATE;   // кусок ≈ 5 минут: слова появляются по ходу, есть честный прогресс
const SEEK = 8 * RATE;     // границу куска ищем в тишине в пределах ±8 с

let asr = null;
let loaded = null;

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
  if (asr && loaded === model) return;
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

async function run({ audio, model, language }) {
  await load(model);
  let start = 0;
  while (start < audio.length) {
    const end = cutAt(audio, start + PART);
    const part = audio.subarray(start, end);
    const out = await asr(part, {
      ...(language ? { language } : {}),   // без языка Whisper определит его сам
      task: 'transcribe',
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const offset = start / RATE;
    const words = (out.chunks || [])
      .map((c) => ({
        w: String(c.text || '').trim(),
        s: Math.round(((c.timestamp?.[0] ?? 0) + offset) * 1000) / 1000,
        e: Math.round(((c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) + offset) * 1000) / 1000,
      }))
      .filter((x) => x.w);
    postMessage({ type: 'words', words, done: end / audio.length });
    start = end;
  }
  postMessage({ type: 'done' });
}

self.onmessage = async (e) => {
  try {
    if (e.data.type === 'run') await run(e.data);
  } catch (err) {
    postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
