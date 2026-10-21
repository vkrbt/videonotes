/* Расшифровка речи в браузере: Whisper через transformers.js, слова с таймингами.
   Модуль-воркер, чтобы распознавание не подвешивало страницу. Модель качается один раз
   и дальше лежит в кеше браузера; звук никуда не отправляется.
   Получает по одному куску звука (≈45 с), всё видео целиком в память не попадает:
   какой кусок следующий и откуда его взять, решает страница. */
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

env.allowLocalModels = false;

const MODELS = {
  base: 'onnx-community/whisper-base_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
  turbo: 'onnx-community/whisper-large-v3-turbo_timestamped',
};
const RATE = 16000;
const PAD = Math.round(0.4 * RATE); // Whisper теряет крайние слова — по краям куска немного тишины

let asr = null;
let loaded = null;

let dev = null;
async function device() {
  dev ??= detect();
  return dev;
}
async function detect() {
  if (!navigator.gpu) return { device: 'wasm', f16: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { device: 'wasm', f16: false };
    return { device: 'webgpu', f16: adapter.features.has('shader-f16') };
  } catch {
    return { device: 'wasm', f16: false };
  }
}

// Самые лёгкие сборки, которые держат качество: в памяти модель — главный расход
function dtypeFor(model, d) {
  if (d.device === 'webgpu' && d.f16) return { encoder_model: model === 'turbo' ? 'q4f16' : 'fp16', decoder_model_merged: 'q4f16' };
  if (d.device === 'webgpu') return { encoder_model: 'q4', decoder_model_merged: 'q4' };
  return { encoder_model: 'q8', decoder_model_merged: 'q8' };
}

async function load(model) {
  const d = await device();
  // turbo (~560 МБ) — только на видеокарте с fp16; иначе берём обычную, чтобы не уронить вкладку
  if (model === 'turbo' && !(d.device === 'webgpu' && d.f16)) model = 'small';
  if (asr && loaded === model) return;
  if (asr) { await asr.dispose?.(); asr = null; }
  const dtype = dtypeFor(model, d);
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

// audio — кусок с start (с запасом по краям); оставляем слова, чья середина в [a, b)
async function part({ id, audio, start, a, b, model, language }) {
  await load(model);
  const piece = new Float32Array(audio.length + PAD * 2);
  piece.set(audio, PAD);
  const out = await asr(piece, {
    ...(language ? { language } : {}),
    task: 'transcribe',
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const offset = start - PAD / RATE;
  const words = (out.chunks || [])
    .map((c) => {
      const s = (c.timestamp?.[0] ?? 0) + offset;
      const e = Math.max(s, (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) + offset);
      return { w: String(c.text || '').trim(), s: Math.round(s * 1000) / 1000, e: Math.round(e * 1000) / 1000 };
    })
    .filter((x) => x.w && (x.s + x.e) / 2 >= a && (x.s + x.e) / 2 < b);
  postMessage({ type: 'words', id, words });
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') await load(m.model);
    else if (m.type === 'part') await part(m);
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err?.message || err) });
  }
};
