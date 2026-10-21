'use strict';

/* ============================================================
   Video Notes — правки к видео по таймкодам.
   Хранилище совместимо со старой версией: notes::<имя файла>,
   notes::youtube_<id>, notes::types.
============================================================ */

/* ---------- утилиты ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
const notesWord = (n) => `${n} ${plural(n, ['правка', 'правки', 'правок'])}`;

function fmt(sec, { ms = true, hours = longVideo() } = {}) {
  // Считаем в целых миллисекундах: иначе 1.2 с из-за плавающей точки показывается как 00:01.199
  const total = ms ? Math.round(Math.max(0, sec || 0) * 1000) : Math.floor(Math.max(0, sec || 0)) * 1000;
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const p = (x, n = 2) => String(x).padStart(n, '0');
  let out = hours || h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  if (ms) out += '.' + p(total % 1000, 3);
  return out;
}

function parseTimeParam(v) {
  if (!v) return 0;
  if (/^\d+(\.\d+)?s?$/.test(v)) return parseFloat(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function relDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1 && new Date().getDate() === d.getDate()) return 'сегодня';
  if (days < 2) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/* ---------- иконки ---------- */

const svg = (body, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 14),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  pencil: svg('<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/><path d="m14.5 5.5 3 3"/>', 15),
  retime: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/>', 15),
  trash: svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>', 15),
  more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>', 16),
  frame: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><ellipse cx="12" cy="12" rx="4.5" ry="3"/>', 16),
};

/* ---------- хранилище ---------- */

const PREFIX = 'notes::';
// Путь видео: генерация (+ текст описания) → правки → готово к публикации → опубликовано
const STATUSES = {
  generation: { label: 'Генерация', c: '#c084fc' },
  edits: { label: 'Правки', c: '#8ea0ff' },
  ready: { label: 'Готово к публикации', c: '#ffb547' },
  published: { label: 'Опубликовано', c: 'var(--ok)' },
};
const DEFAULT_STATUS = 'edits';
const CAPTION_LIMIT = 2200; // лимит подписи в Instagram
const TYPES_KEY = 'notes::types';
const SETTINGS_KEY = 'videonotes::settings';
const DEFAULT_TYPES = ['Правка', 'Таймкод', 'Хук', 'Шорт', 'Другое'];
const TYPE_COLORS = ['#ff6b6b', '#8ea0ff', '#ffb547', '#c084fc', '#9a9aae', '#35d07f', '#2dd4d4', '#f472b6', '#a3e635', '#fb923c'];
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const FORMATS = [
  { id: 'html', label: 'Монтажёру', ext: 'html', mime: 'text/html' },
  { id: 'agent', label: 'Агенту', ext: 'md', mime: 'text/markdown' },
  { id: 'txt', label: 'Текст', ext: 'txt', mime: 'text/plain' },
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
];

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch {
      toast('Не удалось сохранить: память браузера переполнена', { kind: 'error' });
      return false;
    }
  },
  remove(key) { localStorage.removeItem(key); },
  projectKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== TYPES_KEY) out.push(k);
    }
    return out;
  },
};

const DEFAULT_SETTINGS = {
  autopause: true,
  speed: 1,
  export: { format: 'html', ms: true, showType: true, hideDone: false, links: true, header: false, excluded: [] },
};

function loadSettings() {
  const s = store.get(SETTINGS_KEY) || {};
  const out = { ...DEFAULT_SETTINGS, ...s, export: { ...DEFAULT_SETTINGS.export, ...(s.export || {}) } };
  if (!out.msEverywhere) {
    out.export.ms = true; // таймкоды теперь везде с миллисекундами
    out.msEverywhere = true;
  }
  return out;
}
const saveSettings = () => store.set(SETTINGS_KEY, state.settings);

function loadTypes() {
  const t = store.get(TYPES_KEY);
  return Array.isArray(t) && t.length && t.every((x) => typeof x === 'string') ? t : [...DEFAULT_TYPES];
}
const saveTypes = () => store.set(TYPES_KEY, state.types);

/** Старые записи бывают двух видов: точка {seconds,type,text} и диапазон {type:'range',startSeconds,...} */
function normalizeNote(n) {
  if (!n || typeof n !== 'object') return null;
  if (n.type === 'range') {
    const s = +(n.startSeconds ?? n.seconds) || 0;
    const e = +n.endSeconds || s;
    return {
      id: n.id || uid(),
      seconds: Math.min(s, e),
      end: Math.abs(e - s) >= 0.1 ? Math.max(s, e) : null,
      type: n.rangeType || 'Таймкод',
      text: String(n.description ?? n.text ?? ''),
      done: !!n.done,
      createdAt: n.createdAt || 0,
      shapes: normShapes(n.shapes),
      shot: !!n.shot,
    };
  }
  const s = +n.seconds || 0;
  return {
    id: n.id || uid(),
    seconds: s,
    end: isNum(n.end) && n.end > s ? n.end : null,
    type: String(n.type || DEFAULT_TYPES[0]),
    text: String(n.text ?? ''),
    done: !!n.done,
    createdAt: n.createdAt || 0,
    shapes: normShapes(n.shapes),
    shot: !!n.shot,
  };
}

const SHAPE_KINDS = ['ellipse', 'rect', 'arrow', 'pen'];
function normShapes(list) {
  if (!Array.isArray(list)) return null;
  const out = list.filter((x) => x && SHAPE_KINDS.includes(x.t) && Array.isArray(x.p) && x.p.length >= 2 && x.p.every(isNum))
    .map((x) => ({ t: x.t, c: /^#[0-9a-f]{6}$/i.test(x.c) ? x.c : '#ff3b30', p: x.p.map((v) => Math.round(clamp(v, -0.2, 1.2) * 1000) / 1000) }));
  return out.length ? out : null;
}

function keyFor(src) {
  if (src.kind === 'youtube') return `${PREFIX}youtube_${src.id}`;
  if (src.kind === 'url') return `${PREFIX}url:${src.url}`;
  return PREFIX + src.name;
}

function readProject(key) {
  const d = store.get(key);
  if (!d || typeof d !== 'object') return null;
  const name = d.videoFileName || key.slice(PREFIX.length);
  const kind = d.kind || (name.startsWith('youtube_') ? 'youtube' : name.startsWith('url:') ? 'url' : 'file');
  const ytId = d.ytId || (kind === 'youtube' ? name.slice(8) : null);
  const url = d.url || (kind === 'youtube' ? `https://youtu.be/${ytId}` : kind === 'url' ? name.slice(4) : null);
  const rawNotes = Array.isArray(d.notes) ? d.notes : Array.isArray(d) ? d : [];
  return {
    key,
    kind,
    name,
    title: d.title || (kind === 'youtube' ? `YouTube · ${ytId}` : kind === 'url' ? fileNameFromUrl(url) : name),
    url,
    ytId,
    vertical: !!d.vertical,
    duration: +d.duration || 0,
    position: isNum(d.position) ? d.position : null,
    updatedAt: +d.updatedAt || 0,
    path: typeof d.path === 'string' ? d.path : '',
    meta: d.meta && typeof d.meta === 'object' ? d.meta : {},
    status: STATUSES[d.status] ? d.status : DEFAULT_STATUS,
    statusAt: +d.statusAt || 0,
    desc: typeof d.desc === 'string' ? d.desc : '',
    sources: typeof d.sources === 'string' ? d.sources : '',
    notes: sortNotes(rawNotes.map(normalizeNote).filter(Boolean)),
  };
}

function serialize(p) {
  return {
    videoFileName: p.name,
    kind: p.kind,
    title: p.title,
    url: p.url || undefined,
    ytId: p.ytId || undefined,
    vertical: p.vertical || undefined,
    duration: p.duration || undefined,
    position: isNum(p.position) ? Math.round(p.position * 10) / 10 : undefined,
    updatedAt: p.updatedAt || undefined,
    path: p.path || undefined,
    meta: Object.keys(p.meta || {}).length ? p.meta : undefined,
    status: p.status !== DEFAULT_STATUS ? p.status : undefined,
    statusAt: p.status !== DEFAULT_STATUS ? p.statusAt : undefined,
    desc: p.desc || undefined,
    sources: p.sources || undefined,
    notes: p.notes.map((n) => ({
      id: n.id,
      seconds: n.seconds,
      end: n.end ?? undefined,
      type: n.type,
      text: n.text,
      done: n.done || undefined,
      createdAt: n.createdAt || undefined,
      shapes: n.shapes || undefined,
      shot: n.shot || undefined,
    })),
  };
}

function sortNotes(notes) {
  return notes.sort((a, b) => a.seconds - b.seconds || (a.createdAt || 0) - (b.createdAt || 0));
}

/** Пустые проекты не пишем — чтобы «Мои видео» не забивались просмотренным без правок */
function saveProject({ touch = true } = {}) {
  const p = state.project;
  if (!p) return;
  if (!p.notes.length && p.status === DEFAULT_STATUS && !p.desc && !p.sources && localStorage.getItem(p.key) === null) return;
  if (touch) p.updatedAt = Date.now();
  store.set(p.key, serialize(p));
  renderLibraryCount();
}

function allProjects() {
  return store.projectKeys()
    .map(readProject)
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
  } catch {
    return url;
  }
}

/* ---------- состояние ---------- */

/** Видео длиннее часа: показываем часы во всех таймкодах интерфейса */
function longVideo() {
  return (state.dur || state.project?.duration || 0) >= 3600;
}

const state = {
  settings: loadSettings(),
  types: loadTypes(),
  type: null,
  project: null,
  filter: 'all',
  pending: null,        // момент, замороженный при начале набора
  markIn: null,
  markOut: null,
  pausedByComposer: false,
  dur: 0,
  activeId: null,
  lastPosSave: 0,
  attachKey: null,      // из «Моих видео» выбрали локальный файл — ждём, когда его откроют
  objectUrl: null,
  pendingImport: null,
  attach: null,         // пометки на кадре для новой правки: { shapes, img }
  selecting: null,      // протягивание по карте правок
};
state.type = state.types[0];

/* ---------- элементы ---------- */

const el = {
  startScreen: $('#startScreen'),
  workspace: $('#workspace'),
  urlForm: $('#urlForm'),
  urlInput: $('#urlInput'),
  fileInput: $('#fileInput'),
  dropZone: $('#dropZone'),
  attachHint: $('#attachHint'),
  backToVideoBtn: $('#backToVideoBtn'),
  recent: $('#recent'),
  recentList: $('#recentList'),
  recentAllBtn: $('#recentAllBtn'),

  sourceInfo: $('#sourceInfo'),
  sourceKind: $('#sourceKind'),
  sourceTitle: $('#sourceTitle'),
  statusBtn: $('#statusBtn'),
  libraryBtn: $('#libraryBtn'),
  libraryCount: $('#libraryCount'),
  changeSourceBtn: $('#changeSourceBtn'),
  exportBtn: $('#exportBtn'),
  hotkeysBtn: $('#hotkeysBtn'),
  themeBtn: $('#themeBtn'),

  player: $('.player'),
  playerFrame: $('#playerFrame'),
  video: $('#video'),
  ytHost: $('#ytHost'),
  timeline: $('#timeline'),
  tlProgress: $('#tlProgress'),
  tlMarkers: $('#tlMarkers'),
  tlHead: $('#tlHead'),
  tlTip: $('#tlTip'),
  tlTrack: $('#tlTrack'),
  tlLane: $('#tlLane'),
  tlNow: $('#tlNow'),
  tlGuide: $('#tlGuide'),
  tlTipText: $('#tlTipText'),
  tlThumb: $('#tlThumb'),
  tlSel: $('#tlSel'),
  drawBtn: $('#drawBtn'),
  drawLayer: $('#drawLayer'),
  drawBar: $('#drawBar'),
  drawTools: $('#drawTools'),
  drawColors: $('#drawColors'),
  drawUndo: $('#drawUndo'),
  drawCapture: $('#drawCapture'),
  drawCancel: $('#drawCancel'),
  drawDone: $('#drawDone'),
  attach: $('#attach'),
  attachImg: $('#attachImg'),
  attachInfo: $('#attachInfo'),
  attachEdit: $('#attachEdit'),
  attachRemove: $('#attachRemove'),
  shotDialog: $('#shotDialog'),
  shotTitle: $('#shotTitle'),
  shotImg: $('#shotImg'),
  shotSeekBtn: $('#shotSeekBtn'),
  shotEditBtn: $('#shotEditBtn'),
  exportFrame: $('#exportFrame'),
  exportOpenBtn: $('#exportOpenBtn'),
  exportZipBtn: $('#exportZipBtn'),
  pathRow: $('#pathRow'),
  optPath: $('#optPath'),
  backBtn: $('#backBtn'),
  playBtn: $('#playBtn'),
  muteBtn: $('#muteBtn'),
  fullscreenBtn: $('#fullscreenBtn'),
  fwdBtn: $('#fwdBtn'),
  clock: $('#clock'),
  speedSeg: $('#speedSeg'),
  autopauseToggle: $('#autopauseToggle'),

  typeChips: $('#typeChips'),
  stamp: $('#stamp'),
  rangeBtn: $('#rangeBtn'),
  stampHint: $('#stampHint'),
  rangeClearBtn: $('#rangeClearBtn'),
  stampNowBtn: $('#stampNowBtn'),
  noteInput: $('#noteInput'),
  addBtn: $('#addBtn'),

  notesCount: $('#notesCount'),
  panelTabs: $('#panelTabs'),
  descBadge: $('#descBadge'),
  descPane: $('#descPane'),
  captions: $('#captions'),
  capView: $('#capView'),
  textStart: $('#textStart'),
  textModel: $('#textModel'),
  textLang: $('#textLang'),
  textRunBtn: $('#textRunBtn'),
  textHint: $('#textHint'),
  textProgress: $('#textProgress'),
  textBar: $('#textBar'),
  tlAsr: $('#tlAsr'),
  textStatus: $('#textStatus'),
  textCancelBtn: $('#textCancelBtn'),
  words: $('#words'),
  textFoot: $('#textFoot'),
  textMeta: $('#textMeta'),
  textRedoBtn: $('#textRedoBtn'),
  descText: $('#descText'),
  descSources: $('#descSources'),
  descCount: $('#descCount'),
  descCopyBtn: $('#descCopyBtn'),
  copyAllBtn: $('#copyAllBtn'),
  filters: $('#filters'),
  notesList: $('#notesList'),

  exportDialog: $('#exportDialog'),
  formatSeg: $('#formatSeg'),
  exportTypes: $('#exportTypes'),
  optShowType: $('#optShowType'),
  optHideDone: $('#optHideDone'),
  optMs: $('#optMs'),
  optLinks: $('#optLinks'),
  optLinksRow: $('#optLinksRow'),
  optHeader: $('#optHeader'),
  exportPreview: $('#exportPreview'),
  exportSummary: $('#exportSummary'),
  exportCopyBtn: $('#exportCopyBtn'),
  exportDownloadBtn: $('#exportDownloadBtn'),
  exportShareBtn: $('#exportShareBtn'),

  libraryDialog: $('#libraryDialog'),
  libraryList: $('#libraryList'),
  exportAllMdBtn: $('#exportAllMdBtn'),
  backupBtn: $('#backupBtn'),
  restoreInput: $('#restoreInput'),

  importDialog: $('#importDialog'),
  importBtn: $('#importBtn'),
  importInput: $('#importInput'),
  importText: $('#importText'),
  importConfirmBtn: $('#importConfirmBtn'),
  hotkeysDialog: $('#hotkeysDialog'),

  dragOverlay: $('#dragOverlay'),
  toasts: $('#toasts'),
};

/* ---------- тосты ---------- */

function toast(message, { kind = 'info', action, onAction, timeout = 3500 } = {}) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = action;
    b.addEventListener('click', () => { onAction?.(); close(); });
    t.append(b);
  }
  // Открытый <dialog> живёт в верхнем слое и перекрывает всё остальное — тосты кладём внутрь него
  const host = $('dialog[open]') || document.body;
  if (el.toasts.parentNode !== host) host.append(el.toasts);
  el.toasts.append(t);
  while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
  let timer = setTimeout(close, action ? Math.max(timeout, 6000) : timeout);
  function close() {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  }
  return close;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(s) {
  return String(s || 'video').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'video';
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

/* ============================================================
   ПЛЕЕР: один интерфейс над <video> и YouTube
============================================================ */

const player = {
  mode: null, // 'video' | 'yt'
  yt: null,
  ytReady: false,

  time() {
    if (this.mode === 'yt') return this.ytReady ? this.yt.getCurrentTime() || 0 : 0;
    return el.video.currentTime || 0;
  },
  duration() {
    if (this.mode === 'yt') return this.ytReady ? this.yt.getDuration() || 0 : 0;
    return Number.isFinite(el.video.duration) ? el.video.duration : 0;
  },
  paused() {
    if (this.mode === 'yt') {
      if (!this.ytReady) return true;
      const s = this.yt.getPlayerState();
      return s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING;
    }
    return el.video.paused;
  },
  play() {
    if (this.mode === 'yt') this.ytReady && this.yt.playVideo();
    else if (this.mode === 'video') el.video.play().catch(() => {});
  },
  pause() {
    if (this.mode === 'yt') this.ytReady && this.yt.pauseVideo();
    else if (this.mode === 'video') el.video.pause();
  },
  toggle() { this.paused() ? this.play() : this.pause(); },
  // follow: черновик правки переезжает вслед за перемоткой
  seek(t, { follow = true } = {}) {
    const d = this.duration();
    t = d ? clamp(t, 0, d - 0.05) : Math.max(0, t);
    if (this.mode === 'yt') this.ytReady && this.yt.seekTo(t, true);
    else if (this.mode === 'video') el.video.currentTime = t;
    if (follow) followComposer(t);
    tick();
  },
  muted() {
    if (this.mode === 'yt') return this.ytReady ? this.yt.isMuted() : false;
    return el.video.muted;
  },
  toggleMute() {
    if (this.mode === 'yt') {
      if (!this.ytReady) return;
      this.muted() ? this.yt.unMute() : this.yt.mute();
    } else {
      el.video.muted = !el.video.muted;
    }
    setTimeout(tick, 50);
  },
  setRate(r) {
    if (this.mode === 'yt') this.ytReady && this.yt.setPlaybackRate(r);
    else el.video.playbackRate = r;
  },
  stop() {
    if (draw.active) closeDraw();
    setThumbSource(null);
    el.video.pause();
    if (this.yt) {
      try { this.yt.destroy(); } catch { /* уже уничтожен */ }
    }
    this.yt = null;
    this.ytReady = false;
    el.ytHost.innerHTML = '';
    el.video.removeAttribute('src');
    el.video.load();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    this.mode = null;
  },
};

let ytApiPromise = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApiPromise = null; reject(new Error('YouTube API не загрузился')); };
    document.head.append(s);
  });
  return ytApiPromise;
}

/* ---------- источники ---------- */

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|ogg|avi|m3u8)$/i;

/** Ссылка на страницу Drive → поток файла. Исходную ссылку сохраняем для заметок и экспорта. */
function googleDriveVideo(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '');
  if (!['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'].includes(host)) return null;
  const pathId = u.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/|$)/);
  const queryId = ['/', '/open', '/uc', '/download'].includes(u.pathname) ? u.searchParams.get('id') : null;
  const id = pathId?.[1] || queryId;
  if (!id || !/^[\w-]{10,200}$/.test(id)) return null;
  const media = new URL('https://drive.usercontent.google.com/download');
  media.searchParams.set('id', id);
  media.searchParams.set('export', 'download');
  media.searchParams.set('confirm', 't');
  const resourceKey = u.searchParams.get('resourcekey');
  if (resourceKey) media.searchParams.set('resourcekey', resourceKey);
  const proxy = new URL('/api/drive', 'https://videonotes.vkrbt.me');
  proxy.searchParams.set('id', id);
  if (resourceKey) proxy.searchParams.set('resourcekey', resourceKey);
  // На основном сайте функция работает с тем же origin; локальная версия использует её по HTTPS.
  const onSite = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname === 'videonotes.vkrbt.me';
  return { id, mediaUrl: media.href, playbackUrl: onSite ? proxy.pathname + proxy.search : proxy.href };
}

function parseSource(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text) && /^(www\.|m\.|youtu|(?:[\w-]+\.)+[a-z]{2,}\/)/i.test(text)) text = 'https://' + text;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;

  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = null;
    let vertical = false;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) { id = m[2]; vertical = m[1] === 'shorts'; }
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return { kind: 'error', message: 'Не нашла ID видео в ссылке YouTube' };
    return {
      kind: 'youtube',
      id,
      vertical,
      url: vertical ? `https://youtube.com/shorts/${id}` : `https://youtu.be/${id}`,
      start: parseTimeParam(u.searchParams.get('t') || u.searchParams.get('start')),
    };
  }
  const drive = googleDriveVideo(u.href);
  if (drive) return { kind: 'url', url: u.href, title: `Google Drive · ${drive.id}`, guessed: false };
  if (host === 'drive.google.com') return { kind: 'error', message: 'Вставь ссылку на видеофайл Google Drive: «Поделиться» → «Копировать ссылку». Ссылка на папку не подойдёт.' };
  return { kind: 'url', url: u.href, title: fileNameFromUrl(u.href), guessed: !VIDEO_EXT.test(u.pathname) };
}

function isVideoFile(file) {
  return !!file && (file.type.startsWith('video/') || VIDEO_EXT.test(file.name));
}

function openFile(file) {
  if (!isVideoFile(file)) {
    toast('Это не похоже на видеофайл', { kind: 'error' });
    return;
  }
  let key = PREFIX + file.name;

  // Открыли «Мои видео» → локальный файл, а выбрали файл с другим именем (например, новый рендер)
  if (state.attachKey && state.attachKey !== key) {
    const from = readProject(state.attachKey);
    const target = readProject(key);
    if (from?.notes.length && !target?.notes.length &&
        confirm(`Перенести ${notesWord(from.notes.length)} из «${from.title}» на «${file.name}»?`)) {
      store.set(key, { ...serialize(from), videoFileName: file.name, title: file.name, updatedAt: Date.now() });
    }
  }
  state.attachKey = null;

  const project = readProject(key) || blankProject({ kind: 'file', name: file.name, title: file.name }, key);
  project.title = file.name;
  project.meta = { ...project.meta, size: file.size, modified: file.lastModified, mime: file.type || undefined };
  player.stop();
  state.file = file;        // для расшифровки звук читаем прямо из файла
  state.objectUrl = URL.createObjectURL(file);
  startProject(project);
  mountVideo(state.objectUrl);
}

function openSource(src) {
  state.file = null;
  if (!src) {
    toast('Не похоже на ссылку', { kind: 'error' });
    return false;
  }
  if (src.kind === 'error') {
    toast(src.message, { kind: 'error' });
    return false;
  }
  state.attachKey = null;
  const key = keyFor(src);
  const project = readProject(key) || blankProject(src, key);
  player.stop();
  if (src.kind === 'youtube') {
    project.vertical = project.vertical || !!src.vertical;
    startProject(project);
    mountYouTube(src.id, src.start || resumePoint(project));
  } else {
    const drive = googleDriveVideo(src.url);
    if (drive && (!project.title || project.title === fileNameFromUrl(src.url))) {
      project.title = `Google Drive · ${drive.id}`;
    }
    startProject(project);
    mountVideo(drive ? drive.playbackUrl : src.url, { remote: true, drive: !!drive });
  }
  return true;
}

function blankProject(src, key) {
  return {
    key,
    kind: src.kind,
    name: key.slice(PREFIX.length),
    title: src.title || (src.kind === 'youtube' ? 'YouTube' : src.name || 'Видео'),
    url: src.kind === 'file' ? null : src.url,
    ytId: src.kind === 'youtube' ? src.id : null,
    vertical: !!src.vertical,
    duration: 0,
    position: null,
    updatedAt: 0,
    path: '',
    meta: {},
    status: DEFAULT_STATUS,
    statusAt: 0,
    desc: '',
    sources: '',
    notes: [],
  };
}

function resumePoint(p) {
  if (isNum(p.position) && p.position > 1) return p.position;
  if (p.notes.length) return Math.max(...p.notes.map((n) => n.end ?? n.seconds));
  return 0;
}

function mountVideo(src, { remote = false, drive = false } = {}) {
  player.mode = 'video';
  el.playerFrame.classList.remove('is-yt', 'vertical');
  el.video.playbackRate = state.settings.speed;
  // Ссылку сначала пробуем с CORS — тогда с кадра можно снять снимок с пометками.
  // Сервер без CORS такой запрос отклонит, тогда грузим как обычно
  if (remote) el.video.crossOrigin = 'anonymous';
  else el.video.removeAttribute('crossorigin');
  el.video.src = src;
  setThumbSource(src);
  const p = state.project;
  el.video.addEventListener('loadedmetadata', () => {
    if (state.project !== p) return;
    el.video.playbackRate = state.settings.speed;
    p.meta = { ...p.meta, width: el.video.videoWidth || undefined, height: el.video.videoHeight || undefined };
    const at = resumePoint(p);
    if (at > 1 && at < el.video.duration - 1) {
      el.video.currentTime = at;
      toast(`Продолжаю с ${fmt(at)}`);
    }
    tick();
  }, { once: true });
  el.video.onerror = () => {
    if (state.project !== p) return;
    if (remote && !drive && el.video.crossOrigin) {
      el.video.removeAttribute('crossorigin');
      el.video.src = src;
      return;
    }
    toast(drive
      ? 'Не удалось загрузить видео с Google Drive. Если доступ по ссылке открыт, попробуй ещё раз: Google может временно ограничивать загрузку. Можно также скачать файл и перетащить сюда.'
      : remote
      ? 'Видео по ссылке не открылось. Нужна прямая ссылка на файл; Instagram и VK так не отдают — скачай файл и перетащи сюда.'
      : 'Браузер не умеет играть этот файл. Попробуй MP4 (H.264) или WebM.', { kind: 'error', timeout: 8000 });
  };
}

async function mountYouTube(id, startAt = 0) {
  player.mode = 'yt';
  el.playerFrame.classList.add('is-yt');
  el.playerFrame.classList.toggle('vertical', !!state.project.vertical);
  el.ytHost.innerHTML = '<div id="ytMount"></div>';
  const p = state.project;
  try {
    await loadYouTubeApi();
  } catch (err) {
    toast(err.message, { kind: 'error' });
    return;
  }
  if (state.project !== p) return;
  // Свою панель и клавиши YouTube прячем — управление только наше, чтобы не путаться
  const vars = { rel: 0, playsinline: 1, modestbranding: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3 };
  if (startAt > 1) vars.start = Math.floor(startAt);
  if (/^https?:$/.test(location.protocol)) vars.origin = location.origin;
  player.yt = new YT.Player('ytMount', {
    videoId: id,
    playerVars: vars,
    events: {
      onReady: () => {
        if (state.project !== p) return;
        player.ytReady = true;
        player.setRate(state.settings.speed);
        const data = player.yt.getVideoData?.();
        if (data?.title && data.title !== p.title) {
          p.title = data.title;
          renderSource();
          saveProject({ touch: false });
        }
        if (startAt > 1) toast(`Продолжаю с ${fmt(startAt)}`);
        tick();
      },
      onStateChange: () => tick(),
      onError: (e) => {
        const msg = e.data === 101 || e.data === 150 || e.data === 153
          ? 'Автор запретил встраивать это видео. Скачай файл и открой его здесь.'
          : 'YouTube не смог открыть видео';
        toast(msg, { kind: 'error', timeout: 8000 });
      },
    },
  });
}


/* ============================================================
   СНИМКИ КАДРОВ И ОБВОДКА
   Картинки — в IndexedDB: localStorage на скриншотах быстро упрётся в лимит.
   Фигуры хранятся в правке в долях кадра (0..1), поэтому не зависят от размера окна.
============================================================ */

const shots = {
  cache: new Map(),
  dbPromise: null,
  db() {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const r = indexedDB.open('videonotes', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('shots')) db.createObjectStore('shots');
        if (!db.objectStoreNames.contains('transcripts')) db.createObjectStore('transcripts');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.dbPromise;
  },
  async run(mode, fn, name = 'shots') {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const v = await this.run('readonly', (st) => st.get(id)).catch(() => null);
    if (v) this.cache.set(id, v);
    return v || null;
  },
  async put(id, url) {
    this.cache.set(id, url);
    await this.run('readwrite', (st) => st.put(url, id)).catch(() => toast('Не удалось сохранить кадр', { kind: 'error' }));
  },
  async del(id) {
    this.cache.delete(id);
    await this.run('readwrite', (st) => st.delete(id)).catch(() => {});
  },
  keys() {
    return this.run('readonly', (st) => st.getAllKeys()).catch(() => []);
  },
};

async function preloadShots(p) {
  const ids = p.notes.filter((n) => n.shot && !shots.cache.has(n.id)).map((n) => n.id);
  if (!ids.length) return;
  await Promise.all(ids.map((id) => shots.get(id)));
  if (state.project === p) renderNotes();
}

/** Кадры, у которых не осталось правки, удаляем при запуске */
async function cleanupShots() {
  const keys = await shots.keys();
  if (!keys.length) return;
  const alive = new Set(allProjects().flatMap((p) => p.notes.filter((n) => n.shot).map((n) => n.id)));
  keys.filter((k) => !alive.has(k)).forEach((k) => shots.del(k));
}

/** Где внутри player-frame сама картинка видео, без чёрных полей */
function contentRect() {
  const f = el.playerFrame.getBoundingClientRect();
  let r;
  if (player.mode === 'yt') {
    r = el.ytHost.getBoundingClientRect();
  } else {
    const v = el.video.getBoundingClientRect();
    const vw = el.video.videoWidth;
    const vh = el.video.videoHeight;
    if (vw && vh) {
      const k = Math.min(v.width / vw, v.height / vh);
      r = { left: v.left + (v.width - vw * k) / 2, top: v.top + (v.height - vh * k) / 2, width: vw * k, height: vh * k };
    } else {
      r = v;
    }
  }
  return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
}

function drawShape(ctx, s, R) {
  const X = (v) => R.x + v * R.w;
  const Y = (v) => R.y + v * R.h;
  const lw = Math.max(3, Math.min(R.w, R.h) * 0.008);
  const [x1, y1, x2, y2] = s.p;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Сначала тёмная подложка, потом цвет — линия видна и на светлом кадре
  const outline = 'rgba(0, 0, 0, 0.55)';

  if (s.t === 'arrow') {
    const ax = X(x1), ay = Y(y1), bx = X(x2), by = Y(y2);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const head = Math.min(len * 0.6, lw * 5.5);
    const half = head * 0.62;
    const baseX = bx - ux * head, baseY = by - uy * head;
    const shaft = () => {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(baseX + ux * 2, baseY + uy * 2);
    };
    const tip = () => {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(baseX - uy * half, baseY + ux * half);
      ctx.quadraticCurveTo(baseX + ux * head * 0.18, baseY + uy * head * 0.18, baseX + uy * half, baseY - ux * half);
      ctx.closePath();
    };
    shaft(); ctx.strokeStyle = outline; ctx.lineWidth = lw + 3; ctx.stroke();
    tip(); ctx.lineWidth = 3; ctx.stroke();
    shaft(); ctx.strokeStyle = s.c; ctx.lineWidth = lw; ctx.stroke();
    tip(); ctx.fillStyle = s.c; ctx.fill();
    return;
  }

  const path = () => {
    ctx.beginPath();
    if (s.t === 'ellipse') {
      ctx.ellipse((X(x1) + X(x2)) / 2, (Y(y1) + Y(y2)) / 2, Math.abs(X(x2) - X(x1)) / 2, Math.abs(Y(y2) - Y(y1)) / 2, 0, 0, Math.PI * 2);
    } else if (s.t === 'rect') {
      const rx = Math.min(X(x1), X(x2)), ry = Math.min(Y(y1), Y(y2));
      const rw = Math.abs(X(x2) - X(x1)), rh = Math.abs(Y(y2) - Y(y1));
      if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, Math.min(lw * 2, rw / 2, rh / 2));
      else ctx.rect(rx, ry, rw, rh);
    } else {
      // Карандаш: кривые через середины соседних точек — линия от руки без «ступенек»
      const pts = s.p;
      ctx.moveTo(X(pts[0]), Y(pts[1]));
      if (pts.length < 6) {
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(X(pts[i]), Y(pts[i + 1]));
      } else {
        for (let i = 2; i < pts.length - 2; i += 2) {
          ctx.quadraticCurveTo(X(pts[i]), Y(pts[i + 1]), (X(pts[i]) + X(pts[i + 2])) / 2, (Y(pts[i + 1]) + Y(pts[i + 3])) / 2);
        }
        ctx.lineTo(X(pts[pts.length - 2]), Y(pts[pts.length - 1]));
      }
    }
  };
  path(); ctx.strokeStyle = outline; ctx.lineWidth = lw + 3; ctx.stroke();
  path(); ctx.strokeStyle = s.c; ctx.lineWidth = lw; ctx.stroke();
}

const DRAW_COLORS = ['#ff3b30', '#ffd60a', '#35d07f', '#4d6bff', '#ffffff'];
const draw = {
  active: false,
  tool: SHAPE_KINDS.includes(state.settings.drawTool) ? state.settings.drawTool : 'pen',
  color: DRAW_COLORS.includes(state.settings.drawColor) ? state.settings.drawColor : DRAW_COLORS[0],
  shapes: [],
  cur: null,
  target: null,     // id правки, если обводим уже существующую
  at: 0,
  wasPlaying: false,
  overlay: null,    // фигуры правки, которая сейчас на экране
};

function paintLayer() {
  const c = el.drawLayer;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(el.playerFrame.clientWidth * dpr);
  const h = Math.round(el.playerFrame.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const list = draw.active ? [...draw.shapes, ...(draw.cur ? [draw.cur] : [])] : draw.overlay || [];
  if (!list.length || !player.mode) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = contentRect();
  list.forEach((s) => drawShape(ctx, s, R));
}

function refreshOverlay() {
  draw.overlay = (state.activeId && findNote(state.activeId)?.shapes) || null;
  if (!draw.active) paintLayer();
}

function renderDrawBar() {
  $$('[data-tool]', el.drawTools).forEach((b) => b.classList.toggle('on', b.dataset.tool === draw.tool));
  el.drawColors.innerHTML = DRAW_COLORS.map((c) =>
    `<button class="swatch ${c === draw.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Цвет ${c}"></button>`).join('');
  el.drawUndo.disabled = !draw.shapes.length;
  el.drawCapture.classList.toggle('on', !!tabCap.video);
  el.drawCapture.textContent = tabCap.video ? 'Кадр снимется' : 'Разрешить снимок кадра';
}

function openDraw({ target = null } = {}) {
  if (!state.project || !player.mode || draw.active) return;
  draw.wasPlaying = !player.paused();
  player.pause();
  const n = target && findNote(target);
  draw.active = true;
  draw.target = target;
  draw.shapes = structuredClone((n ? n.shapes : state.attach?.shapes) || []);
  draw.cur = null;
  draw.at = n ? n.seconds : state.pending ?? player.time();
  el.playerFrame.classList.add('drawing');
  el.drawBar.hidden = false;
  el.drawCapture.hidden = frameReadable() || !navigator.mediaDevices?.getDisplayMedia;
  renderDrawBar();
  paintLayer();
  el.player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closeDraw() {
  draw.active = false;
  draw.cur = null;
  el.playerFrame.classList.remove('drawing');
  el.drawBar.hidden = true;
  refreshOverlay();
}

/* Пометка прикрепляется сразу, как только фигура нарисована, — без кнопки «Готово».
   Снимок кадра асинхронный: берём только последний результат, если рисуют быстро */
let commitToken = 0;
let commitPromise = null;

function commitDraw() {
  const token = ++commitToken;
  const shapes = draw.shapes.slice();
  const target = draw.target;
  const at = draw.at;
  const wasPlaying = draw.wasPlaying;
  commitPromise = (async () => {
    const img = shapes.length ? await snapshot(shapes) : null;
    if (token !== commitToken) return;

    if (target) {
      const n = findNote(target);
      if (!n) return;
      n.shapes = shapes.length ? shapes : null;
      n.shot = !!img;
      if (img) await shots.put(n.id, img);
      else shots.del(n.id);
      saveProject();
      renderNotes();
      return;
    }

    state.attach = shapes.length ? { shapes, img } : null;
    if (shapes.length) {
      if (state.pending === null && state.markIn === null) state.pending = at;
      if (wasPlaying) state.pausedByComposer = true;
    } else if (!el.noteInput.value.trim() && state.markIn === null) {
      state.pending = null;
    }
    renderAttach();
    renderComposer();
  })();
  return commitPromise;
}

/** Дождаться последнего снимка — чтобы правка ушла с актуальным кадром */
async function settleDraw() {
  let p;
  do {
    p = commitPromise;
    await p;
  } while (p !== commitPromise);
}

function undoShape() {
  if (!draw.shapes.length) return;
  draw.shapes.pop();
  renderDrawBar();
  paintLayer();
  commitDraw();
}

function clearShapes() {
  draw.shapes = [];
  renderDrawBar();
  paintLayer();
  commitDraw();
}

function layerPoint(e) {
  const f = el.playerFrame.getBoundingClientRect();
  const R = contentRect();
  return [(e.clientX - f.left - R.x) / R.w, (e.clientY - f.top - R.y) / R.h];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Можно ли прочитать пиксели кадра. Видео с чужого сервера без CORS «заражает» canvas */
function frameReadable() {
  if (player.mode !== 'video' || !el.video.videoWidth) return false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(el.video, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/** Кадр + пометки → JPEG. Если кадр снять нельзя, остаются только пометки на тёмном фоне */
async function snapshot(shapes) {
  const R = contentRect();
  let source = null;
  let sx = 0, sy = 0, sw = 0, sh = 0;
  let W = R.w * 2;
  let H = R.h * 2;

  if (frameReadable()) {
    source = el.video;
    sw = W = el.video.videoWidth;
    sh = H = el.video.videoHeight;
  } else if (tabCap.video) {
    // Прячем пометки и панель, ждём свежий кадр захвата и вырезаем из него плеер
    el.drawLayer.style.visibility = 'hidden';
    el.drawBar.hidden = true;
    await sleep(350);
    const v = tabCap.video;
    const f = el.playerFrame.getBoundingClientRect();
    const kx = v.videoWidth / window.innerWidth;
    const ky = v.videoHeight / window.innerHeight;
    source = v;
    sx = (f.left + R.x) * kx;
    sy = (f.top + R.y) * ky;
    sw = W = R.w * kx;
    sh = H = R.h * ky;
    el.drawLayer.style.visibility = '';
    el.drawBar.hidden = !draw.active;
  } else {
    toast(player.mode === 'yt'
      ? 'Кадр YouTube не снят — сохранила только пометки. Нажми «Разрешить снимок кадра» в панели рисования.'
      : 'Сервер видео не даёт снять кадр — сохранила только пометки. Можно нажать «Разрешить снимок кадра».', { timeout: 6000 });
  }

  const k = Math.min(1, 1280 / W);
  const w = Math.max(2, Math.round(W * k));
  const h = Math.max(2, Math.round(H * k));
  const paint = (withFrame) => {
    const canvas = document.createElement('canvas'); // новый холст: «заражённый» уже не прочитать
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, w, h);
    if (withFrame && source) ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
    shapes.forEach((sh2) => drawShape(ctx, sh2, { x: 0, y: 0, w, h }));
    return canvas.toDataURL('image/jpeg', 0.82);
  };
  try {
    return paint(true);
  } catch {
    return paint(false);
  }
}

/** Захват вкладки — единственный способ снять кадр YouTube: iframe чужой, пиксели из него не прочитать */
const tabCap = {
  stream: null,
  video: null,
  async start() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 8 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      });
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      this.stream = stream;
      this.video = v;
      stream.getVideoTracks()[0].addEventListener('ended', () => this.stop());
      toast('Готово: кадры будут сниматься, пока браузер показывает вкладку. Остановить можно этой же кнопкой.', { kind: 'ok', timeout: 6000 });
    } catch {
      toast('Без доступа к вкладке кадр не снять — сохраню только пометки');
    }
    renderDrawBar();
  },
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    if (draw.active) renderDrawBar();
  },
};

function renderAttach() {
  const a = state.attach;
  el.attach.hidden = !a;
  if (!a) return;
  el.attachImg.src = a.img || '';
  el.attachInfo.textContent = `${a.shapes.length} ${plural(a.shapes.length, ['фигура', 'фигуры', 'фигур'])}${a.img ? '' : ' · без кадра'}`;
}

function openShot(n) {
  const img = shots.cache.get(n.id);
  if (!img) {
    player.seek(n.seconds, { follow: false });
    player.pause();
    return;
  }
  el.shotTitle.textContent = `${fmt(n.seconds)} · ${n.type}`;
  el.shotImg.src = img;
  el.shotDialog.dataset.id = n.id;
  el.shotDialog.showModal();
}

/* ============================================================
   ЭКРАНЫ
============================================================ */

/* ---------- вкладки: правки / описание к публикации ---------- */

function setPanelTab(tab) {
  state.panelTab = tab;
  $$('[data-tab]', el.panelTabs).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const notes = tab === 'notes';
  el.descPane.hidden = tab !== 'desc';
  el.notesList.hidden = !notes;
  el.filters.hidden = !notes || el.filters.dataset.empty === '1';
  el.copyAllBtn.hidden = !notes;
  if (tab === 'desc') renderDesc();
}

function renderDesc() {
  const p = state.project;
  if (!p) return;
  if (document.activeElement !== el.descText) el.descText.value = p.desc || '';
  if (document.activeElement !== el.descSources) el.descSources.value = p.sources || '';
  renderDescMeta();
}

function renderDescMeta() {
  const p = state.project;
  const len = (p?.desc || '').length;
  el.descCount.textContent = `${len} / ${CAPTION_LIMIT}`;
  el.descCount.classList.toggle('over', len > CAPTION_LIMIT);
  el.descBadge.textContent = len ? '✓' : '';
  el.descCopyBtn.disabled = !len;
}

/* ---------- текст: расшифровка речи по словам, протягивание по словам → правка к отрезку ----------
   Память — главное ограничение. В памяти одновременно: модель в воркере (80–560 МБ, выгружается
   после работы), один кусок звука ≈47 с (~1,5 МБ) и текст. Всё видео целиком не декодируется:
   ffmpeg вырезает нужный кусок прямо из файла на диске. На странице — только окно слов вокруг места. */

const ASR = {
  rate: 16000,
  part: 45,                 // секунд в куске
  edge: 1,                  // запас по краям куска, слова на стыке не теряются
  maxSec: 3 * 3600,         // длиннее — не берёмся: слишком долго и много текста
  fastBytes: 50e6,          // короткий ролик декодируем целиком встроенным декодером…
  fastSec: 300,             // …но только если он и маленький, и короткий
  urlBytes: 200e6,          // видео по ссылке держим в памяти — не больше этого
  win: 240,                 // слов в DOM по каждую сторону от текущего
  saveEvery: 15000,         // расшифровку пишем в браузер не чаще раза в 15 с
};

const tr = {
  words: null,      // [{ w, s, e }] — слово и его начало/конец в секундах
  meta: null,
  done: [],         // [[от, до]] — какие секунды уже расшифрованы
  spans: [],        // только окно слов в DOM
  win: [0, 0],      // [первый, последний+1] — какие слова сейчас в DOM
  blocks: [],       // абзацы [от, до) по фразам и паузам: окно меняется целыми абзацами, строки не переразбиваются
  busy: false,
  worker: null,
  src: null,        // откуда брать куски звука (ffmpeg или короткий ролик в памяти)
  pending: null,    // ответ воркера на текущий кусок
  prev: null,       // что было до «Расшифровать заново» — вернём, если ничего не выйдет
  sel: null,        // { a, b } — индексы слов, выделение всегда целыми словами
  drag: null,
  cur: -1,
  stopAt: null,
  redo: false,      // показать выбор языка и модели над готовым текстом
  line: 0,
  manual: false,    // листают колесом — не дёргаем строки, пока не пойдёт следующее слово
  saveTimer: null,
  quoted: null,     // цитата, которую подставили в правку последней — её заменит новое выделение
  noAuto: false,    // нажали «Остановить» — сами не продолжаем, пока не нажмут «Продолжить»
  autoAt: 0,        // когда последний раз проверяли, нужен ли текст впереди
  autoFail: 0,      // после ошибки не пытаемся сами минуту
};

/* ---------- хранение: текст упакован — строка слов и два Float32Array с таймингами ---------- */

function packWords(words) {
  return { text: words.map((w) => w.w).join('\u0001'), s: Float32Array.from(words, (w) => w.s), e: Float32Array.from(words, (w) => w.e) };
}
function unpackWords(p) {
  if (Array.isArray(p)) return p;
  if (!p?.text) return [];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return p.text.split('\u0001').map((w, i) => ({ w, s: r3(p.s[i]), e: r3(p.e[i]) }));
}

async function loadTranscript(p) {
  if (tr.busy) cancelTranscribe();
  Object.assign(tr, { words: null, meta: null, done: [], sel: null, cur: -1, redo: false, manual: false, noAuto: false, autoFail: 0, quoted: null });
  renderTranscript();
  renderAsrRanges();
  const v = await shots.run('readonly', (st) => st.get(p.key), 'transcripts').catch(() => null);
  if (state.project !== p) return;
  const words = v ? unpackWords(v.words) : [];
  if (!words.length) return;
  tr.words = words;
  tr.meta = v.meta || null;
  tr.done = v.done || [[0, v.meta?.duration || words.at(-1).e]];
  renderTranscript();
  renderAsrRanges();
}

function saveTranscript(now = false) {
  clearTimeout(tr.saveTimer);
  tr.saveTimer = null;
  const p = state.project;
  if (!p || !tr.words?.length) return;
  const write = () => shots.run('readwrite', (st) => st.put({ words: packWords(tr.words), meta: tr.meta, done: tr.done }, p.key), 'transcripts')
    .catch(() => toast('Не удалось сохранить расшифровку в браузере', { kind: 'error' }));
  if (now) write();
  else tr.saveTimer = setTimeout(write, ASR.saveEvery);
}

/* ---------- откуда брать звук: кусок по требованию, весь звук в памяти не держим ---------- */

const FFCORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core';

function fileReadError(err) {
  return err?.name === 'NotReadableError' || err?.name === 'NotFoundError'
    ? new Error('Браузер потерял доступ к файлу — его переместили, переименовали или он ещё синхронизируется (iCloud/Drive). Открой файл заново через «Другое видео».')
    : new Error('Не удалось прочитать звук из этого файла');
}

// Видео по ссылке — в Blob частями (сервер Drive отдаёт по Range), не больше ASR.urlBytes
async function fetchBlob(url) {
  const tooBig = () => new Error(`Видео по ссылке больше ${Math.round(ASR.urlBytes / 1e6)} МБ — скачай его и открой файлом: так расшифровка не забьёт память.`);
  const first = await fetch(url);
  if (!first.ok) throw new Error(String(first.status));
  const size = Number((first.headers.get('Content-Range') || '').split('/')[1] || first.headers.get('Content-Length'));
  if (size > ASR.urlBytes) { first.body?.cancel(); throw tooBig(); }
  if (first.status !== 206) return first.blob();
  const parts = [await first.blob()];
  let got = parts[0].size;
  while (got < size) {
    const r = await fetch(url, { headers: { Range: `bytes=${got}-` } });
    if (!r.ok) throw new Error(String(r.status));
    const chunk = await r.blob();
    if (!chunk.size) break;
    parts.push(chunk);
    got += chunk.size;
    setTextProgress(null, `Загружаю видео: ${Math.round((got / size) * 100)}%`);
  }
  return new Blob(parts);
}

async function decode16k(buf) {
  const decoded = await new OfflineAudioContext(1, 1, ASR.rate).decodeAudioData(buf);
  const out = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const d = decoded.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / decoded.numberOfChannels;
  }
  return out;
}

function int16ToFloat(raw) {
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

// ffmpeg в браузере читает файл с диска кусочками (WORKERFS) и отдаёт только нужный отрезок
async function ffmpegSource(blob) {
  setTextProgress(null, 'Готовлю ffmpeg — звук будем доставать кусками…');
  const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
  const ff = new FFmpeg();
  try {
    await ff.load({ coreURL: FFCORE + '.js', wasmURL: FFCORE + '.wasm' });
    const file = blob instanceof File ? blob : new File([blob], 'input.mp4');
    await ff.createDir('/in');
    await ff.mount('WORKERFS', { files: [file] }, '/in');
    const path = `/in/${file.name}`;
    return {
      async part(a, b) {
        const code = await ff.exec(['-nostdin', '-v', 'error', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', path,
          '-vn', '-ac', '1', '-ar', String(ASR.rate), '-f', 's16le', '/p.pcm']);
        if (code !== 0) throw new Error('ffmpeg ' + code);
        const raw = await ff.readFile('/p.pcm');
        await ff.deleteFile('/p.pcm');
        return int16ToFloat(raw);
      },
      close() { try { ff.terminate(); } catch { /* уже закрыт */ } },
    };
  } catch (err) {
    try { ff.terminate(); } catch { /* уже закрыт */ }
    throw err;
  }
}

async function audioSource(dur) {
  let blob = state.file;
  if (!blob) {
    try { blob = await fetchBlob(el.video.currentSrc); } catch (err) {
      throw /МБ/.test(err.message) ? err : new Error('По этой ссылке браузеру не дают скачать видео, а без него звук не достать. Скачай видео и открой его как файл.');
    }
  }
  // Короткий маленький ролик: один раз декодируем целиком (≈20 МБ звука), это быстрее ffmpeg
  if (blob.size <= ASR.fastBytes && dur <= ASR.fastSec) {
    try {
      let buf = await blob.arrayBuffer();
      const pcm = await decode16k(buf);
      buf = null;
      return { part: async (a, b) => pcm.slice(Math.floor(a * ASR.rate), Math.ceil(b * ASR.rate)), close() {} };
    } catch (err) {
      if (err?.name === 'NotReadableError' || err?.name === 'NotFoundError') throw fileReadError(err);
      // встроенный декодер не понял формат — ffmpeg справится
    }
  }
  try {
    return await ffmpegSource(blob);
  } catch (err) {
    throw fileReadError(err);
  }
}

/* ---------- распознавание: по куску, с текущего момента, перемотка переносит фокус ---------- */

function setTextProgress(frac, text) {
  if (frac !== null) el.textBar.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  if (text) el.textStatus.textContent = text;
}

function mergeRanges(list) {
  const out = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a <= last[1] + 0.5) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function renderAsrRanges() {
  const d = state.dur;
  el.tlAsr.innerHTML = d ? tr.done.map(([a, b]) => `<i style="left:${(a / d) * 100}%;width:${Math.max(0.3, ((b - a) / d) * 100)}%"></i>`).join('') : '';
}

function transcribePartial() {
  return !!(tr.words?.length && tr.meta?.partial);
}

// Индекс первого слова с началом ≥ t
function wordIndexAt(t) {
  const w = tr.words || [];
  let lo = 0, hi = w.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (w[m].s < t) lo = m + 1; else hi = m; }
  return lo;
}

// Слова куска встают на своё место без пересортировки всего текста
function mergeWords(words, a, b) {
  const i0 = wordIndexAt(a), i1 = wordIndexAt(b);
  tr.words.splice(i0, i1 - i0, ...words);
}

// Какую модель можно на этой машине: turbo — только с видеокартой и от 8 ГБ памяти
function asrLimits() {
  const mem = navigator.deviceMemory || 8;
  return { turbo: !!navigator.gpu && mem >= 8, light: mem <= 4 };
}

// Следующий кусок — у текущего места просмотра: сам кусок, следующий, предыдущий, ещё по одному
// вперёд и назад (≈±90 с, больше 10 строк в обе стороны); потом остальное — сперва вперёд
function pickPart(parts, t) {
  const at = parts.findIndex((x) => t >= x.a && t < x.b);
  const k = at < 0 ? parts.length - 1 : at;
  for (const i of [k, k + 1, k - 1, k + 2, k - 2]) if (parts[i] && !parts[i].done) return parts[i];
  return parts.find((x) => !x.done && x.a >= t) || parts.findLast((x) => !x.done) || null;
}

function covered(a, b) {
  return tr.done.some(([x, y]) => x <= a + 0.05 && y >= b - 0.05);
}

// Смотрят видео, а впереди нет текста — недоделанная расшифровка продолжается сама
function autoTranscribe(t) {
  const now = Date.now();
  if (now - tr.autoAt < 2000) return;
  tr.autoAt = now;
  if (tr.busy || tr.noAuto || now < tr.autoFail || !transcribePartial() || player.paused()) return;
  const dur = player.duration() || state.dur;
  if (covered(Math.max(0, t - 5), Math.min(dur, t + 60))) return;
  transcribe({ auto: true });
}

function askWorker(msg, transfer) {
  return new Promise((resolve, reject) => {
    tr.pending = { resolve, reject };
    tr.worker.postMessage(msg, transfer);
  });
}

async function transcribe({ auto = false } = {}) {
  const p = state.project;
  if (!p || tr.busy) return;
  if (!auto) tr.noAuto = false;
  const dur = player.duration() || state.dur;
  if (!dur) { toast('Дождись, пока видео загрузится'); return; }
  if (dur > ASR.maxSec) { toast('Видео длиннее 3 часов — расшифровка в браузере займёт слишком много времени и памяти. Разрежь его на части.', { kind: 'error', timeout: 9000 }); return; }
  // Само продолжаем с теми же моделью и языком, что начали, — не с тем, что сейчас в списках
  let model = auto ? tr.meta.model : el.textModel.value;
  if (model === 'turbo' && !asrLimits().turbo) model = 'small';
  const language = auto ? tr.meta.language || null : el.textLang.value || null;
  const resume = transcribePartial() && !tr.redo && tr.meta.model === model && (tr.meta.language || null) === language;
  if (auto && !resume) return;
  if (!resume && tr.words?.length && !confirm('Расшифровать заново? Текущая расшифровка заменится новой.')) return;
  tr.prev = tr.words ? { words: tr.words, meta: tr.meta, done: tr.done } : null;
  if (!resume) { tr.words = []; tr.done = []; }
  tr.meta = { model, language, partial: true, at: Date.now(), duration: Math.round(dur) };
  Object.assign(tr, { busy: true, redo: false, sel: null });
  renderTranscript();
  renderAsrRanges();
  el.textBar.hidden = true;
  el.textStatus.hidden = false;
  setTextProgress(0, 'Готовлю звук…');
  try {
    tr.src = await audioSource(dur);
  } catch (err) {
    finishTranscribe(true);
    toast(err.message, { kind: 'error', timeout: 9000 });
    return;
  }
  if (state.project !== p || !tr.busy) return;

  tr.worker = new Worker('asr-worker.js', { type: 'module' });
  tr.worker.onmessage = ({ data: m }) => {
    if (m.type === 'download') {
      // только полоса: меняющиеся цифры дёргали плашку
      el.textBar.hidden = false;
      el.textStatus.hidden = true;
      el.textProgress.title = `Скачиваю модель, один раз: ${Math.round(m.total / 1e6)} МБ`;
      setTextProgress(m.loaded / m.total, null);
    } else if (m.type === 'ready') {
      el.textBar.hidden = true;
      el.textStatus.hidden = false;
      el.textProgress.title = '';
    } else if (m.type === 'words') {
      tr.pending?.resolve(m.words);
    } else if (m.type === 'error') {
      tr.pending?.reject(new Error(m.message));
    }
  };
  tr.worker.onerror = () => tr.pending?.reject(new Error('Распознавание не запустилось в этом браузере'));

  const parts = [];
  for (let a = 0; a < dur; a += ASR.part) {
    const b = Math.min(dur, a + ASR.part);
    parts.push({ a, b, done: tr.done.some(([x, y]) => x <= a + 0.05 && y >= b - 0.05) });
  }
  const startDone = parts.filter((x) => x.done).length;
  const t0 = Date.now();
  try {
    for (;;) {
      if (!tr.busy || state.project !== p) return;
      const next = pickPart(parts, player.time());
      if (!next) break;
      const from = Math.max(0, next.a - ASR.edge), to = Math.min(dur, next.b + ASR.edge);
      let audio;
      try { audio = await tr.src.part(from, to); } catch (err) { throw fileReadError(err); }
      if (!tr.busy) return;
      const words = await askWorker({ type: 'part', id: next.a, audio, start: from, a: next.a, b: next.b, model, language }, [audio.buffer]);
      audio = null;
      if (!tr.busy || state.project !== p) return;
      next.done = true;
      mergeWords(words, next.a, next.b);
      tr.done = mergeRanges([...tr.done, [next.a, next.b]]);
      const doneN = parts.filter((x) => x.done).length;
      const perPart = (Date.now() - t0) / 1000 / Math.max(1, doneN - startDone);
      const left = Math.round(((parts.length - doneN) * perPart) / 60);
      setTextProgress(null, `Расшифровано ${Math.round((doneN / parts.length) * 100)}%${left ? ` · осталось ~${left} мин` : ''}`);
      renderTranscript();
      renderAsrRanges();
      saveTranscript();
    }
    tr.meta.partial = false;
    tr.meta.at = Date.now();
    finishTranscribe(false);
    saveTranscript(true);
    toast(tr.words.length ? 'Расшифровка готова' : 'Речи в видео не нашлось');
  } catch (err) {
    if (!tr.busy) return;
    tr.autoFail = Date.now() + 60000;
    const kept = !!tr.words.length;
    finishTranscribe(!kept);
    if (kept) saveTranscript(true);
    toast('Не получилось расшифровать: ' + err.message, { kind: 'error', timeout: 9000 });
  }
}

// failed — ничего не получилось: возвращаем прежнюю расшифровку. Модель и ffmpeg выгружаем в любом случае
function finishTranscribe(failed) {
  tr.busy = false;
  tr.worker?.terminate();
  tr.worker = null;
  tr.src?.close();
  tr.src = null;
  tr.pending = null;
  if (failed) {
    tr.words = tr.prev?.words || null;
    tr.meta = tr.prev?.meta || null;
    tr.done = tr.prev?.done || [];
  }
  tr.prev = null;
  renderTranscript();
  renderAsrRanges();
}

function cancelTranscribe({ user = false } = {}) {
  if (user) tr.noAuto = true;
  if (!tr.busy) return;
  const kept = !!tr.words?.length;
  finishTranscribe(!kept);
  if (kept) saveTranscript(true);
}

/* ---------- полоса под видео: три строки, в DOM только окно слов вокруг текущего ---------- */

function renderTranscript() {
  const has = !!tr.words?.length;
  const yt = player.mode === 'yt';
  const limits = asrLimits();
  const turbo = el.textModel.querySelector('option[value="turbo"]');
  if (turbo) turbo.disabled = !limits.turbo;
  if (el.textModel.value === 'turbo' && !limits.turbo) el.textModel.value = 'small';
  const partial = transcribePartial() && !tr.redo;
  el.captions.hidden = !state.project || !player.mode;
  el.captions.classList.toggle('has-text', has);
  el.textStart.hidden = tr.busy || (has && !tr.redo && !partial);
  el.textRunBtn.textContent = partial ? 'Продолжить расшифровку' : 'Расшифровать';
  el.textProgress.hidden = !tr.busy;
  el.capView.hidden = !has;
  el.textFoot.hidden = !has || tr.busy;
  el.textRunBtn.disabled = yt;
  const pct = tr.meta?.duration ? Math.round((tr.done.reduce((s, [a, b]) => s + b - a, 0) / tr.meta.duration) * 100) : 0;
  el.textHint.textContent = yt
    ? 'У YouTube-видео браузер не даёт достать звук — скачай видео и открой его файлом.'
    : partial
      ? `Расшифровано ${pct}% — продолжим с текущего момента.`
      : 'В браузере, звук никуда не уходит. Начнём с текущего момента.';
  if (!has) {
    el.words.innerHTML = '';
    tr.spans = [];
    tr.win = [0, 0];
    return;
  }
  const t = player.mode ? player.time() : 0;
  buildBlocks();
  keepInPlace(() => renderWindow(tr.cur >= 0 ? tr.cur : Math.max(0, wordIndexAt(t) - 1)));
  const label = { base: 'лёгкая', small: 'быстрая', turbo: 'точная' }[tr.meta?.model] || 'быстрая';
  el.textMeta.textContent = `${tr.words.length} ${plural(tr.words.length, ['слово', 'слова', 'слов'])} · ${label} модель`;
}

// Абзац заканчивается на конце фразы (не короче 18 слов), на паузе больше 1,2 с или на 60 словах
function buildBlocks() {
  const w = tr.words, out = [];
  let start = 0;
  for (let i = 0; i < w.length; i++) {
    const len = i - start + 1, next = w[i + 1];
    const gap = next ? next.s - w[i].e : Infinity;
    if (!next || (len >= 18 && /[.!?…]$/.test(w[i].w)) || (len >= 8 && gap > 1.2) || len >= 60) {
      out.push([start, i + 1]);
      start = i + 1;
    }
  }
  tr.blocks = out;
}

function blockOf(i) {
  const b = tr.blocks;
  let lo = 0, hi = b.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m][0] <= i) lo = m; else hi = m - 1; }
  return lo;
}

// Окно — целые абзацы вокруг слова center, примерно ASR.win слов в каждую сторону
function renderWindow(center) {
  const b = tr.blocks;
  if (!b.length) return;
  const c = blockOf(clamp(center, 0, tr.words.length - 1));
  let b0 = c, b1 = c + 1;
  const count = () => b[b1 - 1][1] - b[b0][0];
  while (count() < ASR.win * 2 && (b0 > 0 || b1 < b.length)) {
    if (b0 > 0) b0--;
    if (b1 < b.length && count() < ASR.win * 2) b1++;
  }
  tr.win = [b[b0][0], b[b1 - 1][1]];
  el.words.innerHTML = b.slice(b0, b1).map(([i0, i1]) =>
    `<div class="blk">${tr.words.slice(i0, i1).map((w, k) => `<span class="w" data-i="${i0 + k}">${esc(w.w)}</span>`).join(' ')}</div>`).join('');
  tr.spans = [...el.words.querySelectorAll('.w')];
  tr.cur = -1;
  paintSel();
  paintNoted();
}

// Перестроили окно — слово, на которое смотрят, остаётся на том же месте, без анимации и скачка
function keepInPlace(rebuild) {
  const anchor = tr.cur >= 0 ? tr.cur : Number(tr.spans.find((s) => lineOf(s) === tr.line)?.dataset.i ?? -1);
  const before = spanOf(anchor) ? lineOf(spanOf(anchor)) : null;
  const line = tr.line;
  rebuild();
  const s = spanOf(anchor);
  el.words.style.transition = 'none';
  if (before !== null && s) showLine(line + lineOf(s) - before);
  else showLine(tr.spans.length ? lineOf(tr.spans[0]) : 0);
  void el.words.offsetHeight;   // применить сдвиг сразу, до возврата анимации
  el.words.style.transition = '';
  renderWordNow();
}

function spanOf(i) {
  return i >= tr.win[0] && i < tr.win[1] ? tr.spans[i - tr.win[0]] : null;
}

function lineH() {
  return parseFloat(getComputedStyle(el.words).lineHeight) || 25;
}
// Номер строки, на которой стоит слово, — по его середине, а не по верху
function lineOf(span) {
  return Math.max(0, Math.floor((span.offsetTop + span.offsetHeight / 2) / lineH()));
}
// Строка idx всегда в середине окна: в начале над ней пусто, в конце — под ней
function showLine(idx) {
  tr.line = idx;
  el.words.style.transform = `translateY(${(1 - idx) * lineH()}px)`;
}
function lastLine() {
  return Math.max(0, Math.round(el.words.scrollHeight / lineH()) - 1);
}
// Колесо: листаем по строке; у края окна слов подгружаем соседние
function shiftLines(n) {
  if (!tr.spans.length) return;
  tr.manual = true;
  let idx = tr.line + n;
  const nearTop = idx < 2 && tr.win[0] > 0;
  const nearEnd = idx > lastLine() - 2 && tr.win[1] < tr.words.length;
  if (nearTop || nearEnd) {
    const anchor = tr.spans.find((s) => lineOf(s) === clamp(idx, 0, lastLine()));
    const ai = anchor ? Number(anchor.dataset.i) : tr.win[0];
    keepInPlace(() => renderWindow(ai));
    idx = lineOf(spanOf(ai) || tr.spans[0]);
  }
  showLine(clamp(idx, 0, lastLine()));
}

function renderWordNow(t = player.mode ? player.time() : 0) {
  if (tr.stopAt !== null && t >= tr.stopAt) {
    tr.stopAt = null;
    player.pause();
  }
  if (el.captions.hidden !== (!state.project || !player.mode)) { renderTranscript(); return; }
  if (!el.captions.hidden) autoTranscribe(t);
  if (el.captions.hidden || !tr.spans.length) return;
  let i = wordIndexAt(t + 0.02) - 1;
  if (i >= 0 && t > tr.words[i].e + 0.6) i = -1;
  if (i === tr.cur) return;
  // текущее слово ушло к краю окна — перестраиваем окно вокруг него
  if (i >= 0 && !tr.drag && ((i < tr.win[0] + 30 && tr.win[0] > 0) || (i >= tr.win[1] - 30 && tr.win[1] < tr.words.length))) {
    keepInPlace(() => renderWindow(i));
    return;
  }
  spanOf(tr.cur)?.classList.remove('now');
  tr.cur = i;
  const span = spanOf(i);
  if (!span) return;
  span.classList.add('now');
  if (tr.drag) return;
  if (tr.manual && player.paused()) return;
  tr.manual = false;
  showLine(lineOf(span));
}

function selRange() {
  return tr.sel ? [Math.min(tr.sel.a, tr.sel.b), Math.max(tr.sel.a, tr.sel.b)] : null;
}

function paintSel() {
  const r = selRange();
  tr.spans.forEach((s, k) => {
    const i = tr.win[0] + k;
    s.classList.toggle('sel', !!r && i >= r[0] && i <= r[1]);
  });
}

function paintNoted() {
  const p = state.project;
  if (!p || !tr.spans.length) return;
  const ranges = p.notes.filter((n) => n.end !== null && n.end !== undefined).map((n) => [Math.min(n.seconds, n.end), Math.max(n.seconds, n.end)]);
  tr.spans.forEach((s, k) => {
    const w = tr.words[tr.win[0] + k];
    const mid = (w.s + w.e) / 2;
    s.classList.toggle('noted', ranges.some(([a, b]) => mid >= a && mid <= b));
  });
}

function clearWordSel() {
  tr.sel = null;
  paintSel();
}

function wordFromPoint(x, y) {
  const node = document.elementFromPoint(x, y)?.closest?.('.w');
  return node && el.words.contains(node) ? Number(node.dataset.i) : null;
}

// Ближайшее слово, если курсор ушёл в пробел между словами или за край строки
function nearestWord(x, y) {
  const direct = wordFromPoint(x, y);
  if (direct !== null) return direct;
  let best = null, bestD = Infinity;
  for (const s of tr.spans) {
    const r = s.getBoundingClientRect();
    if (r.bottom < y - 40 || r.top > y + 40) continue;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = dy * 4 + dx;
    if (d < bestD) { bestD = d; best = Number(s.dataset.i); }
  }
  return best;
}

function onWordsDown(e) {
  if (e.button !== 0) return;
  const i = wordFromPoint(e.clientX, e.clientY);
  if (i === null) { if (tr.sel) clearWordSel(); return; }
  e.preventDefault();
  if (e.shiftKey && tr.sel) {
    tr.sel.b = i;
    paintSel();
    noteFromWords();
    return;
  }
  tr.drag = { start: i, moved: false, id: e.pointerId };
  tr.sel = { a: i, b: i };
  el.words.setPointerCapture(e.pointerId);
  el.captions.classList.add('dragging');
  paintSel();
}

function onWordsMove(e) {
  if (!tr.drag || e.pointerId !== tr.drag.id) return;
  const i = nearestWord(e.clientX, e.clientY);
  if (i !== null && i !== tr.sel.b) {
    tr.sel.b = i;
    tr.drag.moved = true;
    paintSel();
  }
  // протянули за верх или низ окна в три строки — листаем строки
  const box = el.capView.getBoundingClientRect();
  const now = Date.now();
  if (now - (tr.drag.scrolled || 0) > 220) {
    if (e.clientY > box.bottom) { shiftLines(1); tr.drag.scrolled = now; }
    else if (e.clientY < box.top) { shiftLines(-1); tr.drag.scrolled = now; }
  }
}

function onWordsUp(e) {
  if (!tr.drag || e.pointerId !== tr.drag.id) return;
  const { start, moved } = tr.drag;
  tr.drag = null;
  el.captions.classList.remove('dragging');
  if (!moved) {
    // просто клик по слову — перематываем к нему
    tr.sel = null;
    paintSel();
    tr.manual = false;
    player.seek(tr.words[start].s);
    return;
  }
  // протянули — выделенные слова сразу в заметку, с отрезком по их таймкодам
  noteFromWords();
}

function noteFromWords() {
  const r = selRange();
  if (!r || !state.project) return;
  const s = tr.words[r[0]].s;
  const e = Math.max(tr.words[r[1]].e, s + 0.1);
  const quote = tr.words.slice(r[0], r[1] + 1).map((w) => w.w).join(' ');
  tr.stopAt = null;
  player.pause();
  player.seek(s, { follow: false });
  state.markIn = s;
  state.markOut = e;
  state.pending = s;
  // Выделил заново, пока правка не добавлена, — прежняя цитата и её отрезок заменяются новыми,
  // а то, что успел дописать после цитаты, остаётся
  const quoted = `«${quote}» — `;
  const cur = el.noteInput.value;
  if (tr.quoted && cur.includes(tr.quoted)) el.noteInput.value = cur.replace(tr.quoted, quoted);
  else el.noteInput.value = cur.trim() ? `${quoted}${cur.trim()}` : quoted;
  tr.quoted = quoted;
  autosize(el.noteInput);
  clearWordSel();
  renderSelection();
  renderComposer();
  focusNote();
  el.noteInput.setSelectionRange(el.noteInput.value.length, el.noteInput.value.length);
}

function startProject(p) {
  state.project = p;
  state.dur = p.duration || 0;
  state.filter = 'all';
  state.activeId = null;
  state.lastPosSave = 0;
  draw.overlay = null;
  resetComposer();
  showWorkspace();
  renderSource();
  renderTypes();
  renderNotes();
  renderTimeline();
  setPanelTab('notes');
  renderDescMeta();
  preloadShots(p);
  loadTranscript(p);
  history.replaceState(null, '', location.pathname + location.search);
}

function showWorkspace() {
  el.startScreen.hidden = true;
  el.workspace.hidden = false;
  el.changeSourceBtn.hidden = false;
  el.exportBtn.hidden = false;
  el.attachHint.hidden = true;
}

function showStart({ hint } = {}) {
  player.pause();
  el.startScreen.hidden = false;
  el.workspace.hidden = true;
  el.exportBtn.hidden = true;
  el.changeSourceBtn.hidden = true;
  el.sourceInfo.hidden = true;
  el.backToVideoBtn.hidden = !state.project;
  el.attachHint.hidden = !hint;
  if (hint) el.attachHint.textContent = hint;
  renderRecent();
  window.scrollTo({ top: 0 });
}

function renderSource() {
  const p = state.project;
  el.sourceInfo.hidden = !p;
  if (!p) return;
  el.sourceKind.textContent = (googleDriveVideo(p.url) ? 'Google Drive' : { youtube: 'YouTube', url: 'Ссылка', file: 'Файл' }[p.kind]);
  el.sourceTitle.textContent = p.title;
  el.sourceTitle.title = p.title;
  el.statusBtn.style.setProperty('--c', STATUSES[p.status].c);
  el.statusBtn.innerHTML = `<span class="dot"></span>${esc(statusText(p))}${svg('<path d="m6 9 6 6 6-6"/>', 13)}`;
  document.title = `${p.title} — Video Notes`;
}

function statusText(p) {
  const st = STATUSES[p.status] || STATUSES[DEFAULT_STATUS];
  return p.status === 'published' && p.statusAt ? `${st.label} ${relDate(p.statusAt)}` : st.label;
}

function closeStatusMenu() {
  $$('.status-menu').forEach((m) => m.remove());
}

function toggleStatusMenu() {
  const p = state.project;
  if (!p) return;
  if ($('.status-menu')) return closeStatusMenu();
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = Object.entries(STATUSES).map(([id, st], i) => `
    <button data-status="${id}" role="menuitemradio" aria-checked="${p.status === id}" class="${p.status === id ? 'on' : ''}" style="--c:${st.c}">
      <span class="dot"></span><span class="step">${i + 1}</span>${st.label}
      ${p.status === id ? `<span class="check">${ICON.check}</span>` : ''}
    </button>`).join('');
  menu.style.left = el.statusBtn.offsetLeft + 'px';
  el.sourceInfo.append(menu);
  menu.querySelector('.on, button').focus({ preventScroll: true });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    closeStatusMenu();
    setStatus(b.dataset.status);
  });
}

function setStatus(status) {
  const p = state.project;
  if (!p || p.status === status) return;
  const open = p.notes.filter((n) => !n.done).length;
  if ((status === 'ready' || status === 'published') && open && !confirm(`${notesWord(open)} ещё не ${plural(open, ['отмечена', 'отмечены', 'отмечены'])} сделанными. Всё равно «${STATUSES[status].label}»?`)) return;
  p.status = status;
  p.statusAt = Date.now();
  saveProject();
  renderSource();
  toast(`Статус: ${STATUSES[status].label.toLowerCase()}`, { kind: 'ok' });
}

function renderLibraryCount() {
  const n = store.projectKeys().length;
  el.libraryCount.textContent = n ? String(n) : '';
}

function vidRowHTML(p, { compact = false } = {}) {
  const kind = p.kind === 'youtube' ? '<span class="vid-kind yt">YT</span>'
    : p.kind === 'url' ? '<span class="vid-kind">URL</span>'
    : '<span class="vid-kind">MP4</span>';
  const sub = [notesWord(p.notes.length), p.notes.filter((n) => n.done).length ? `${p.notes.filter((n) => n.done).length} готово` : '', relDate(p.updatedAt)]
    .filter(Boolean).join(' · ');
  return `
    <div class="vid-row" data-key="${esc(p.key)}">
      <button class="vid-open" data-act="open">
        ${kind}
        <span class="vid-main">
          <span class="vid-title">${esc(p.title)}${p.status !== DEFAULT_STATUS ? `<span class="vid-status" style="--c:${STATUSES[p.status].c}">${esc(statusText(p))}</span>` : ''}</span>
          <span class="vid-sub">${esc(sub)}</span>
        </span>
      </button>
      <div class="vid-actions">
        ${compact ? '' : `<button class="btn btn-sm" data-act="copy" title="Скопировать правки текстом">Копировать</button>`}
        <button class="iconbtn" data-act="delete" title="Удалить" aria-label="Удалить">${ICON.trash}</button>
      </div>
    </div>`;
}

function renderRecent() {
  const list = allProjects();
  el.recent.hidden = !list.length;
  el.recentList.innerHTML = list.slice(0, 5).map((p) => vidRowHTML(p, { compact: true })).join('');
  renderLibraryCount();
}

function openFromLibrary(key) {
  const p = readProject(key);
  if (!p) return;
  el.libraryDialog.close();
  if (p.kind === 'youtube') return openSource({ kind: 'youtube', id: p.ytId, url: p.url, vertical: p.vertical });
  if (p.kind === 'url') return openSource({ kind: 'url', url: p.url, title: p.title });
  if (state.project?.key === key && player.mode) return showWorkspace();
  state.attachKey = key;
  showStart({ hint: `Выбери файл «${p.name}» — правки подтянутся сами. Если имя другое (например, новый рендер), предложу перенести правки на него.` });
  el.fileInput.click();
}

function deleteProject(key) {
  const p = readProject(key);
  if (!p) return;
  if (!confirm(`Удалить «${p.title}» и ${notesWord(p.notes.length)}?`)) return;
  const backup = localStorage.getItem(key);
  store.remove(key);
  if (state.project?.key === key) {
    state.project.notes = [];
    renderNotes();
    renderTimeline();
  }
  renderRecent();
  renderLibrary();
  toast('Удалено', {
    action: 'Вернуть',
    onAction: () => {
      localStorage.setItem(key, backup);
      if (state.project?.key === key) {
        state.project.notes = readProject(key).notes;
        renderNotes();
        renderTimeline();
      }
      renderRecent();
      renderLibrary();
    },
  });
}

/* ============================================================
   ТИПЫ
============================================================ */

function typeColor(type) {
  let i = state.types.indexOf(type);
  if (i < 0) i = [...type].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return TYPE_COLORS[i % TYPE_COLORS.length];
}

function renderTypes() {
  const canRemove = state.types.length > 1;
  el.typeChips.innerHTML = state.types.map((t, i) => `
    <button class="type-chip ${t === state.type ? 'on' : ''}" style="--c:${typeColor(t)}" data-type="${esc(t)}"
            title="${i < 9 ? `Клавиша ${i + 1}` : ''}">
      ${esc(t)}${i < 9 ? `<span class="num">${i + 1}</span>` : ''}
      ${canRemove ? `<span class="x" data-remove="${esc(t)}" title="Убрать тип" role="button">${ICON.close}</span>` : ''}
    </button>`).join('') +
    '<button class="type-chip type-add" id="typeAddBtn" title="Новый тип">+ тип</button>';
}

function selectType(t) {
  if (!state.types.includes(t)) return;
  state.type = t;
  renderTypes();
}

function startAddType() {
  const btn = $('#typeAddBtn');
  const input = document.createElement('input');
  input.className = 'type-new';
  input.placeholder = 'Название';
  input.maxLength = 24;
  btn.replaceWith(input);
  input.focus();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && !state.types.includes(name)) {
      state.types.push(name);
      state.type = name;
      saveTypes();
    }
    renderTypes();
    renderNotes();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); focusNote(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function removeType(t) {
  if (state.types.length <= 1) return;
  if (!confirm(`Убрать тип «${t}» из списка? Уже написанные правки сохранят эту метку.`)) return;
  state.types = state.types.filter((x) => x !== t);
  if (state.type === t) state.type = state.types[0];
  saveTypes();
  renderTypes();
  renderNotes();
}

/* ============================================================
   НОВАЯ ПРАВКА
============================================================ */

function resetComposer() {
  state.pending = null;
  state.markIn = null;
  state.markOut = null;
  state.pausedByComposer = false;
  state.attach = null;
  el.noteInput.value = '';
  autosize(el.noteInput);
  renderAttach();
  renderComposer();
}

const RANGE_ICON = svg('<path d="M8 5H5v14h3M16 5h3v14h-3"/><path d="M9.5 12h5"/>', 15);
const END_ICON = svg('<path d="M4 12h11"/><path d="m11 8 4 4-4 4"/><path d="M19 5v14"/>', 15);

function renderComposer(live = player.mode ? player.time() : 0) {
  const { markIn, markOut, pending } = state;
  let html;
  if (markIn !== null) {
    const end = markOut ?? pending;
    html = `${fmt(markIn)} <span class="arrow">→</span> ${end !== null ? fmt(end) : fmt(Math.max(live, markIn))}`;
  } else {
    html = fmt(pending ?? live);
  }
  if (el.stamp.innerHTML !== html) el.stamp.innerHTML = html;
  el.stamp.classList.toggle('frozen', pending !== null || markIn !== null);
  // Момент разошёлся с плеером (видео играет дальше) — кнопка «взять текущий»
  const stale = markIn === null && pending !== null && Math.abs(live - pending) > 0.05;
  if (el.stampNowBtn.hidden === stale) el.stampNowBtn.hidden = !stale;

  // Одна кнопка ведёт по шагам: «Отрезок» → «Конец здесь» → отрезок готов
  const step = markIn === null ? 'none' : markOut === null ? 'open' : 'closed';
  const btn = step === 'open' ? `${END_ICON}Конец здесь` : `${RANGE_ICON}Отрезок`;
  if (el.rangeBtn.innerHTML !== btn) el.rangeBtn.innerHTML = btn;
  el.rangeBtn.classList.toggle('on', step === 'open');
  el.rangeBtn.hidden = step === 'closed';
  el.rangeClearBtn.hidden = step === 'none';
  const hint = step === 'none'
    ? `Правка к моменту ${fmt(pending ?? live)}`
    : step === 'open'
      ? `Начало ${fmt(markIn)}. Нажми «Конец здесь» — или сразу пиши правку`
      : `Правка к отрезку ${fmt(markIn)}–${fmt(markOut)} (${Math.abs(markOut - markIn).toFixed(1)} с)`;
  if (el.stampHint.textContent !== hint) el.stampHint.textContent = hint;
  el.addBtn.disabled = !state.project || (!el.noteInput.value.trim() && markIn === null && !state.attach);
}

/* Начал писать на одном моменте, перемотал на другой — момент правки едет следом.
   Не трогаем готовый отрезок и пометки на кадре: они привязаны к своему кадру. */
function followComposer(t) {
  if (state.pending === null || state.markOut !== null || state.attach) return;
  state.pending = t;
}

function stampToNow() {
  if (state.markIn !== null && state.markOut === null) state.markOut = player.time();
  else if (state.pending !== null) state.pending = player.time();
  renderComposer();
  focusNote();
}

function onComposerInput() {
  const has = el.noteInput.value.trim().length > 0;
  if (has && state.pending === null) {
    state.pending = player.time();
    if (state.settings.autopause && !player.paused()) {
      player.pause();
      state.pausedByComposer = true;
    }
  } else if (!has && state.markIn === null && !state.attach) {
    state.pending = null;
  }
  autosize(el.noteInput);
  renderComposer();
}

function clearRange() {
  state.markIn = null;
  state.markOut = null;
  if (!el.noteInput.value.trim() && !state.attach) state.pending = null;
  renderSelection();
  renderComposer();
}

function markIn() {
  if (!state.project) return;
  state.markIn = player.time();
  state.markOut = null;
  renderComposer();
}

function markOut() {
  if (!state.project) return;
  if (state.markIn === null) {
    toast('Сначала нажми «Отрезок» — отметить начало (клавиша I)');
    return;
  }
  state.markOut = player.time();
  if (state.settings.autopause && !player.paused()) {
    player.pause();
    state.pausedByComposer = true;
  }
  renderComposer();
  focusNote();
}

async function addNote() {
  const p = state.project;
  if (!p) return;
  if (commitPromise) await settleDraw();
  if (draw.active && !draw.target) closeDraw();
  const text = el.noteInput.value.trim();
  if (!text && state.markIn === null && !state.attach) return;

  const at = state.pending ?? player.time();
  let seconds = at;
  let end = null;
  if (state.markIn !== null) {
    const e = state.markOut ?? at;
    seconds = Math.min(state.markIn, e);
    end = Math.max(state.markIn, e);
    if (end - seconds < 0.1) end = null;
  }
  const note = {
    id: uid(), seconds, end, type: state.type, text, done: false, createdAt: Date.now(),
    shapes: state.attach?.shapes || null,
    shot: !!state.attach?.img,
  };
  if (note.shot) shots.put(note.id, state.attach.img);
  p.notes.push(note);
  sortNotes(p.notes);
  saveProject();

  if (state.filter !== 'all' && state.filter !== note.type) state.filter = 'all';
  renderNotes({ flash: note.id });
  renderTimeline();

  const resume = state.pausedByComposer;
  resetComposer();
  if (resume) player.play();
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

/* ============================================================
   СПИСОК ПРАВОК
============================================================ */

function visibleNotes() {
  const notes = state.project?.notes || [];
  return state.filter === 'all' ? notes : notes.filter((n) => n.type === state.filter);
}

function renderFilters() {
  const notes = state.project?.notes || [];
  const counts = new Map();
  notes.forEach((n) => counts.set(n.type, (counts.get(n.type) || 0) + 1));
  if (state.filter !== 'all' && !counts.has(state.filter)) state.filter = 'all';
  el.filters.dataset.empty = counts.size < 2 ? '1' : '';
  el.filters.hidden = counts.size < 2 || state.panelTab !== 'notes';
  el.filters.innerHTML =
    `<button class="type-chip all ${state.filter === 'all' ? 'on' : ''}" data-filter="all" style="--c:var(--accent-text)">Все <span class="num">${notes.length}</span></button>` +
    [...counts].map(([t, c]) => `
      <button class="type-chip ${state.filter === t ? 'on' : ''}" data-filter="${esc(t)}" style="--c:${typeColor(t)}">
        ${esc(t)} <span class="num">${c}</span>
      </button>`).join('');
}

function noteHTML(n) {
  const types = state.types.includes(n.type) ? state.types : [...state.types, n.type];
  const span = n.end !== null
    ? `${fmt(n.seconds)}–${fmt(n.end)}<span class="dur">${(n.end - n.seconds).toFixed(1)} с</span>`
    : fmt(n.seconds);
  return `
    <article class="note ${n.done ? 'done' : ''} ${n.id === state.activeId ? 'active' : ''}" data-id="${n.id}" style="--c:${typeColor(n.type)}">
      <div class="note-top">
        <button class="tc" data-act="seek" title="Перейти к моменту">${span}</button>
        <button class="tool retime" data-act="retime" title="Перенести на текущий момент" aria-label="Перенести на текущий момент">${ICON.retime}</button>
        <select class="type-select" data-act="type" aria-label="Тип правки">
          ${types.map((t) => `<option ${t === n.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <div class="note-tools">
          <button class="tool ok ${n.done ? 'on' : ''}" data-act="done" title="${n.done ? 'Вернуть в работу' : 'Отметить как сделанную'}">${ICON.check}</button>
          <button class="tool" data-act="menu" title="Ещё" aria-haspopup="menu">${ICON.more}</button>
        </div>
      </div>
      <textarea class="note-text" rows="1" placeholder="Без текста">${esc(n.text)}</textarea>
      ${n.shot || n.shapes ? `<button class="note-shot" data-act="shot" title="Открыть кадр">${
        shots.cache.get(n.id) ? `<img src="${shots.cache.get(n.id)}" alt="Кадр ${esc(fmt(n.seconds))}">`
          : `<span class="shape-only">${n.shot ? 'Загружаю кадр…' : 'Пометки без кадра — покажу на видео'}</span>`}</button>` : ''}
    </article>`;
}

function renderNotes({ flash } = {}) {
  if (tr.spans.length) queueMicrotask(paintNoted);
  const p = state.project;
  const all = p?.notes || [];
  const done = all.filter((n) => n.done).length;
  el.notesCount.textContent = all.length ? (done ? `${done}/${all.length}` : String(all.length)) : '';
  el.notesCount.title = all.length ? `${notesWord(all.length)}${done ? `, ${done} сделано` : ''}` : '';
  el.copyAllBtn.disabled = !all.length;
  renderFilters();

  const list = visibleNotes();
  if (!all.length) {
    el.notesList.innerHTML = `
      <div class="notes-empty">
        <strong>Пока пусто</strong>
        Поставь видео на нужный момент и начни печатать — таймкод подставится сам.
      </div>`;
    return;
  }
  el.notesList.innerHTML = list.map(noteHTML).join('');
  $$('.note-text', el.notesList).forEach(autosize);

  if (flash) {
    const node = el.notesList.querySelector(`[data-id="${flash}"]`);
    if (node) {
      node.classList.add('flash');
      scrollToNote(node);
    }
  }
}

/* Меню «⋯» у правки: действия с подписями, а не загадочные иконки */
function closeNoteMenu() {
  $$('.note-menu').forEach((m) => {
    m.closest('.note')?.classList.remove('menu-open');
    m.remove();
  });
}

function toggleNoteMenu(node, n) {
  const open = node.querySelector('.note-menu');
  closeNoteMenu();
  if (open) return;
  const menu = document.createElement('div');
  menu.className = 'note-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button data-act="draw" role="menuitem">${ICON.frame}<span>${n.shapes ? 'Изменить пометки на кадре' : 'Обвести на кадре'}</span></button>
    <button data-act="delete" role="menuitem" class="danger">${ICON.trash}<span>Удалить</span></button>`;
  node.append(menu);
  node.classList.add('menu-open');
  // Не хватает места снизу — открываем вверх
  if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) menu.classList.add('up');
  menu.querySelector('button').focus({ preventScroll: true });
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.note-menu, [data-act="menu"]')) closeNoteMenu();
  if (!e.target.closest('.status-menu, #statusBtn')) closeStatusMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.note-menu')) closeNoteMenu();
  if (e.key === 'Escape' && $('.status-menu')) closeStatusMenu();
}, true);

const findNote = (id) => state.project?.notes.find((n) => n.id === id);

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 400);
}

function deleteNote(id) {
  const p = state.project;
  const i = p.notes.findIndex((n) => n.id === id);
  if (i < 0) return;
  const [removed] = p.notes.splice(i, 1);
  saveProject();
  renderNotes();
  renderTimeline();
  toast(`Правка ${fmt(removed.seconds)} удалена`, {
    action: 'Вернуть',
    onAction: () => {
      if (state.project !== p) return;
      p.notes.push(removed);
      sortNotes(p.notes);
      saveProject();
      renderNotes({ flash: removed.id });
      renderTimeline();
    },
  });
}

function seekToNote(n) {
  player.seek(n.seconds);
  player.play();
}

/* ============================================================
   КАРТА ПРАВОК И ТАЙМЕР
============================================================ */

function renderTimeline() {
  renderAsrRanges();
  const d = state.dur;
  const notes = state.project?.notes || [];
  if (!d) {
    el.tlMarkers.innerHTML = '';
    return;
  }
  el.tlMarkers.innerHTML = notes.map((n) => {
    const left = clamp((n.seconds / d) * 100, 0, 100);
    const width = n.end !== null ? Math.max(0.6, ((n.end - n.seconds) / d) * 100) : 0;
    return `<button class="tl-mark ${n.end !== null ? 'range' : ''} ${n.done ? 'done' : ''}" data-id="${n.id}"
      style="--c:${typeColor(n.type)};left:${left}%;${width ? `width:${width}%` : ''}" aria-label="${esc(fmt(n.seconds))}"></button>`;
  }).join('');
}

function tick() {
  const p = state.project;
  if (!p || !player.mode) return;
  const t = player.time();
  const d = player.duration();

  if (d && Math.abs(d - state.dur) > 0.5) {
    state.dur = d;
    p.duration = Math.round(d);
    renderTimeline();
  }
  const pct = state.dur ? clamp((t / state.dur) * 100, 0, 100) : 0;
  el.tlProgress.style.width = pct + '%';
  el.tlHead.style.left = pct + '%';
  el.tlNow.style.left = pct + '%';
  el.clock.textContent = `${fmt(t)} / ${fmt(state.dur)}`;
  renderSelection(t);
  renderWordNow(t);
  el.player.classList.toggle('playing', !player.paused());
  el.player.classList.toggle('muted', player.muted());
  renderComposer(t);

  // Подсветка правки, которая сейчас на экране
  let active = null;
  for (const n of p.notes) {
    if (n.seconds > t + 0.25) break;
    const until = n.end !== null ? n.end : n.seconds + 3;
    if (t <= until) active = n.id;
  }
  if (active !== state.activeId) {
    state.activeId = active;
    $$('.note.active', el.notesList).forEach((x) => x.classList.remove('active'));
    if (active) el.notesList.querySelector(`[data-id="${active}"]`)?.classList.add('active');
    refreshOverlay();
  } else if (draw.overlay && !draw.active) {
    paintLayer(); // кадр мог поменять размер
  }

  // Позицию запоминаем, чтобы в следующий раз продолжить с того же места
  if (Math.abs(t - (p.position ?? 0)) > 2 && Date.now() - state.lastPosSave > 3000) {
    p.position = t;
    state.lastPosSave = Date.now();
    saveProject({ touch: false });
  }
}

setInterval(tick, 150);

function renderSelection(t = player.time()) {
  const a = state.markIn;
  if (a === null || !state.dur) {
    el.tlSel.hidden = true;
    return;
  }
  const b = state.markOut ?? Math.max(t, a);
  el.tlSel.hidden = false;
  el.tlSel.style.left = (a / state.dur) * 100 + '%';
  el.tlSel.style.width = Math.max(0.4, ((b - a) / state.dur) * 100) + '%';
}

/* Микропревью: перематываем скрытую копию видео, не дожидаясь каждой перемотки —
   берём только последнюю позицию курсора, чтобы превью успевало за мышью */
let thumbWant = null;
function thumbSeek(t) {
  if (el.tlThumb.seeking) { thumbWant = t; return; }
  if (Math.abs(el.tlThumb.currentTime - t) > 0.05) el.tlThumb.currentTime = t;
}
el.tlThumb.addEventListener('seeked', () => {
  if (thumbWant === null) return;
  const t = thumbWant;
  thumbWant = null;
  el.tlThumb.currentTime = t;
});

function setThumbSource(src) {
  thumbWant = null;
  if (src) {
    el.tlThumb.src = src;
  } else {
    el.tlThumb.removeAttribute('src');
    el.tlThumb.load();
  }
}

function timelineTime(e) {
  const r = el.tlMarkers.getBoundingClientRect();
  return { t: clamp((e.clientX - r.left) / r.width, 0, 1) * state.dur, x: e.clientX - el.timeline.getBoundingClientRect().left };
}

/* ============================================================
   ВЫГРУЗКА
============================================================ */

function exportNotes(p, opts) {
  const excluded = new Set(opts.excluded || []);
  return [...p.notes]
    .filter((n) => !excluded.has(n.type) && !(opts.hideDone && n.done))
    .sort((a, b) => a.seconds - b.seconds);
}

function ytLink(p, sec) {
  return p.kind === 'youtube' && p.ytId ? `https://youtu.be/${p.ytId}?t=${Math.floor(sec)}` : null;
}

function buildExport(p, format, opts) {
  const notes = exportNotes(p, opts);
  const tc = (s) => fmt(s, { ms: opts.ms, hours: true });
  const span = (n) => (n.end !== null ? `${tc(n.seconds)} – ${tc(n.end)}` : tc(n.seconds));
  const links = opts.links && p.kind === 'youtube';
  const source = p.url || p.name;

  if (format === 'txt') {
    const lines = notes.map((n) => {
      const head = `${n.done ? '✓ ' : ''}[${span(n)}]${opts.showType ? ` (${n.type})` : ''}`;
      const body = n.text.replace(/\n/g, '\n    ');
      return `${head} ${body}`.trimEnd() + (links ? `\n    ${ytLink(p, n.seconds)}` : '');
    });
    const header = opts.header ? [p.title, ...(p.url ? [p.url] : []), ''] : [];
    return [...header, ...lines].join('\n');
  }

  if (format === 'md') {
    const lines = notes.map((n) => {
      const time = links ? `[${span(n)}](${ytLink(p, n.seconds)})` : span(n);
      const type = opts.showType ? ` · *${n.type}*` : '';
      const body = n.text.replace(/\n/g, '\n  ');
      return `- [${n.done ? 'x' : ' '}] **${time}**${type} — ${body}`;
    });
    const header = opts.header ? [`# ${p.title}`, '', ...(p.url ? [`Видео: ${p.url}`, ''] : [])] : [];
    return [...header, ...lines].join('\n');
  }

  if (format === 'csv') {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['start', 'end', 'duration_sec', 'start_sec', 'type', 'text', 'done', ...(links ? ['link'] : [])];
    const rows = notes.map((n) => [
      q(tc(n.seconds)),
      q(n.end !== null ? tc(n.end) : ''),
      n.end !== null ? (n.end - n.seconds).toFixed(2) : '',
      n.seconds.toFixed(3),
      q(opts.showType ? n.type : ''),
      q(n.text),
      n.done ? 1 : 0,
      ...(links ? [q(ytLink(p, n.seconds))] : []),
    ].join(','));
    return [head.join(','), ...rows].join('\n');
  }

  return JSON.stringify({
    video: videoInfo(p),
    exportedAt: new Date().toISOString(),
    notes: notes.map((n, i) => ({
      start: tc(n.seconds),
      end: n.end !== null ? tc(n.end) : null,
      startSeconds: +n.seconds.toFixed(3),
      endSeconds: n.end !== null ? +n.end.toFixed(3) : null,
      ...(opts.showType ? { type: n.type } : {}),
      text: n.text,
      done: n.done,
      ...(links ? { link: ytLink(p, n.seconds) } : {}),
      ...(n.shapes ? { marks: n.shapes, marksText: n.shapes.map(describeShape) } : {}),
      ...(n.shot ? { shot: shotName(n, i) } : {}),
    })),
  }, null, 2);
}

/* ---------- отчёт: для монтажёра (HTML) и для агента (промпт) ---------- */

function videoInfo(p) {
  const m = p.meta || {};
  return {
    title: p.title,
    kind: p.kind,
    file: p.kind === 'file' ? p.name : undefined,
    path: p.path || undefined,
    url: p.url || undefined,
    duration: p.duration ? fmt(p.duration, { hours: true, ms: false }) : undefined,
    durationSeconds: p.duration || undefined,
    resolution: m.width && m.height ? `${m.width}×${m.height}` : undefined,
    sizeBytes: m.size || undefined,
    modified: m.modified ? new Date(m.modified).toISOString() : undefined,
    status: p.status,
    statusLabel: statusText(p),
    description: p.desc || undefined,
    sources: sourceList(p).length ? sourceList(p) : undefined,
  };
}

const sourceList = (p) => (p.sources || '').split('\n').map((x) => x.trim()).filter(Boolean);

function videoFacts(p) {
  const v = videoInfo(p);
  const size = v.sizeBytes ? `${(v.sizeBytes / 1048576).toFixed(1)} МБ` : null;
  return [
    ['Файл', v.file],
    ['Где лежит', p.kind === 'file' ? v.path || 'не указано — ищи по имени файла' : null],
    ['Ссылка', v.url],
    ['Длительность', v.duration],
    ['Разрешение', v.resolution],
    ['Размер', size],
    ['Изменён', v.modified ? new Date(v.modified).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : null],
    ['Статус', statusText(p)],
  ].filter(([, val]) => val);
}

// Цвет в нужном роде: «красный овал», но «красная стрелка»
const COLOR_NAMES = {
  '#ff3b30': ['красный', 'красная'],
  '#ffd60a': ['жёлтый', 'жёлтая'],
  '#35d07f': ['зелёный', 'зелёная'],
  '#4d6bff': ['синий', 'синяя'],
  '#ffffff': ['белый', 'белая'],
};
const pct = (v) => Math.round(clamp(v, 0, 1) * 100);

/** Словами: где на кадре пометка. x — слева направо, y — сверху вниз, в процентах кадра */
function describeShape(s) {
  const [masc, fem] = COLOR_NAMES[s.c.toLowerCase()] || [s.c, s.c];
  const xs = s.p.filter((_, i) => i % 2 === 0);
  const ys = s.p.filter((_, i) => i % 2 === 1);
  const box = `x ${pct(Math.min(...xs))}–${pct(Math.max(...xs))}%, y ${pct(Math.min(...ys))}–${pct(Math.max(...ys))}%`;
  if (s.t === 'ellipse') return `${masc} овал: ${box}`;
  if (s.t === 'rect') return `${masc} прямоугольник: ${box}`;
  if (s.t === 'arrow') return `${fem} стрелка из (${pct(s.p[0])}%, ${pct(s.p[1])}%) в (${pct(s.p[2])}%, ${pct(s.p[3])}%) — указывает на конечную точку`;
  return `${fem} обводка от руки: ${box}`;
}

function shotName(n, i) {
  return `shots/${String(i + 1).padStart(2, '0')}_${fmt(n.seconds, { hours: true, ms: false }).replace(/:/g, '-')}.jpg`;
}

async function ensureShots(notes) {
  await Promise.all(notes.filter((n) => n.shot).map((n) => shots.get(n.id)));
}

function buildAgentPrompt(p, opts) {
  const notes = exportNotes(p, opts);
  const tc = (sec) => fmt(sec, { ms: true, hours: true });
  const facts = videoFacts(p).map(([k, v]) => `- ${k}: ${v}`);
  const hasMarks = notes.some((n) => n.shapes);
  const items = notes.map((n, i) => {
    const time = n.end !== null ? `${tc(n.seconds)} – ${tc(n.end)} (${(n.end - n.seconds).toFixed(1)} с)` : tc(n.seconds);
    const lines = [`${i + 1}. **${time}** · ${n.type}${n.done ? ' · ✓ уже сделано' : ''}`];
    lines.push(`   ${n.text ? n.text.replace(/\n/g, '\n   ') : '(без текста — смотри пометки на кадре)'}`);
    if (n.shot) lines.push(`   Кадр: ${shotName(n, i)}`);
    if (n.shapes) n.shapes.forEach((sh) => lines.push(`   Пометка: ${describeShape(sh)}`));
    return lines.join('\n');
  });
  return [
    `# Правки к видео «${p.title}»`,
    '',
    '## Видео',
    ...facts,
    '',
    'Самого видео в отчёте нет — возьми исходник по пути или ссылке выше. Если по пути файла нет, найди его по имени и сверь длительность.',
    '',
    '## Описание к публикации',
    ...(p.desc
      ? [p.desc, '', 'Проверь факты и ссылки в описании; если правки меняют смысл ролика — поправь и текст.']
      : ['Описания пока нет. Предложи текст подписи: факт или короткая история по теме видео, без воды. Можно опираться на статьи блога sreda.men и ссылаться на исследования — только реальные, с работающими ссылками.']),
    ...(sourceList(p).length ? ['', 'Источники:', ...sourceList(p).map((x) => `- ${x}`)] : []),
    '',
    '## Что сделать',
    'Внеси правки ниже по порядку. Таймкоды — от начала исходного файла (ЧЧ:ММ:СС.мс). «A – B» значит, что правка про весь кусок.',
    ...(hasMarks ? ['К части правок приложен кадр: на нём обведено место, о котором речь. Те же пометки описаны текстом — x слева направо, y сверху вниз, в процентах кадра. Кадры лежат в папке shots/ рядом с этим файлом, если прислан архив; там же report.html — тот же список для человека.'] : []),
    'Правки с пометкой «✓ уже сделано» не трогай. Если правка непонятна — спроси, не додумывай. В конце коротко отчитайся по каждому пункту.',
    '',
    `## Правки (${notes.length})`,
    '',
    items.join('\n\n'),
    '',
  ].join('\n');
}

const REPORT_CSS = `
*{box-sizing:border-box}body{margin:0;background:#070709;color:#fff;font:15px/1.55 Manrope,-apple-system,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 24px 60px}
.brand{font-weight:800;font-size:12px;letter-spacing:.14em;color:#8ea0ff;text-transform:uppercase}
h1{margin:10px 0 18px;font-size:30px;line-height:1.15}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0 0 18px;padding:16px 18px;border:2px solid #4a4a5e;border-bottom-width:4px;border-radius:16px;background:#0f0f18}
.facts dt{color:#888898}.facts dd{margin:0;word-break:break-all}
.facts a,.tc{color:#8ea0ff}
.how{margin:0 0 28px;color:#c8c8d8}
.item{margin:0 0 14px;padding:16px 18px;border:1px solid rgba(255,255,255,.1);border-left:4px solid var(--c,#888);border-radius:14px;background:#161622;break-inside:avoid}
.item.done{opacity:.55}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px}
.num{color:#888898;font-weight:800}
.tc{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none}
.dur{color:#888898;font-size:13px}
.type{padding:2px 10px;border-radius:99px;background:color-mix(in srgb,var(--c) 18%,transparent);color:color-mix(in srgb,var(--c) 72%,currentColor);font-size:12.5px;font-weight:700}
.ok{color:#35d07f;font-size:13px;font-weight:700}
.item p{margin:4px 0 0;white-space:pre-wrap}
.item img{display:block;max-width:100%;margin-top:12px;border-radius:10px}
.marks{margin:8px 0 0;padding-left:18px;color:#888898;font-size:13px}
footer{margin-top:30px;color:#888898;font-size:12.5px}
.desc{margin:0 0 22px;padding:16px 18px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#161622}
.desc h2{margin:0 0 8px;font-size:15px;color:#c8c8d8}.desc p{margin:0;white-space:pre-wrap}.desc ul{margin:10px 0 0;padding-left:18px;font-size:13.5px}.desc a{color:#8ea0ff;word-break:break-all}
@media (prefers-color-scheme:light){.desc{background:#fff;border-color:rgba(0,0,0,.1)}.desc h2{color:#3f3f52}.desc a{color:#000dc3}body{background:#f5f5fa;color:#101018}.facts{background:#fff;border-color:#101018}.item{background:#fff;border-top-color:rgba(0,0,0,.1);border-right-color:rgba(0,0,0,.1);border-bottom-color:rgba(0,0,0,.1)}.facts dt,.num,.dur,.marks,footer{color:#686878}.brand,.facts a,.tc{color:#000dc3}.ok{color:#1f9d5c}}
@media print{body{background:#fff;color:#111}.facts,.item{background:#fff}.facts{border-color:#ccc}.facts dt,.num,.dur,.marks,footer{color:#666}.facts a,.tc{color:#000dc3}}
`;

/** Отчёт для монтажёра. img(n, i) — откуда брать кадр: data URL (один файл) или shots/… (архив) */
function buildReport(p, opts, img = (n) => shots.cache.get(n.id)) {
  const notes = exportNotes(p, opts);
  const hours = (p.duration || 0) >= 3600;
  const tc = (sec) => fmt(sec, { ms: opts.ms, hours });
  const facts = videoFacts(p).map(([k, v]) => {
    const val = /^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank">${esc(v)}</a>` : esc(v);
    return `<dt>${esc(k)}</dt><dd>${val}</dd>`;
  }).join('');
  const items = notes.map((n, i) => {
    const time = n.end !== null ? `${tc(n.seconds)} – ${tc(n.end)}` : tc(n.seconds);
    const link = ytLink(p, n.seconds);
    const src = n.shot ? img(n, i) : null;
    return `<article class="item${n.done ? ' done' : ''}" style="--c:${typeColor(n.type)}">
<div class="meta"><span class="num">${i + 1}</span>${link ? `<a class="tc" href="${esc(link)}" target="_blank">${time}</a>` : `<span class="tc">${time}</span>`}${n.end !== null ? `<span class="dur">${(n.end - n.seconds).toFixed(1)} с</span>` : ''}${opts.showType ? `<span class="type">${esc(n.type)}</span>` : ''}${n.done ? '<span class="ok">✓ готово</span>' : ''}</div>
${n.text ? `<p>${esc(n.text)}</p>` : ''}
${src ? `<img src="${esc(src)}" alt="Кадр ${time}" loading="lazy">` : ''}
${n.shapes && !src ? `<ul class="marks">${n.shapes.map((sh) => `<li>${esc(describeShape(sh))}</li>`).join('')}</ul>` : ''}
</article>`;
  }).join('\n');
  const date = new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Правки — ${esc(p.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap">
<style>${REPORT_CSS}</style></head>
<body><main>
<div class="brand">Video Notes · правки</div>
<h1>${esc(p.title)}</h1>
<dl class="facts">${facts}<dt>Правок</dt><dd>${notes.length}</dd></dl>
${p.desc || sourceList(p).length ? `<section class="desc"><h2>Описание к публикации</h2>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}${sourceList(p).length ? `<ul>${sourceList(p).map((x) => `<li>${/^https?:\/\//.test(x) ? `<a href="${esc(x)}" target="_blank">${esc(x)}</a>` : esc(x)}</li>`).join('')}</ul>` : ''}</section>` : ''}
<p class="how">Таймкоды — от начала файла. Цветная полоска слева — тип правки${notes.some((n) => n.shot) ? ', на кадрах обведено место, о котором речь' : ''}.</p>
${items}
<footer>Собрано ${esc(date)} в Video Notes</footer>
</main></body></html>`;
}

/* ---------- ZIP без сжатия (JPEG всё равно не сжимается) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const head = (sig, size) => {
      const v = new DataView(new ArrayBuffer(size));
      v.setUint32(0, sig, true);
      return v;
    };
    const local = head(0x04034b50, 30);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // имена в UTF-8
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const cen = head(0x02014b50, 46);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};
function translit(str) {
  return [...str].map((c) => {
    const low = c.toLowerCase();
    if (!(low in TRANSLIT)) return c;
    const t = TRANSLIT[low];
    return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }).join('').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

const dataUrlBytes = (url) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));

async function downloadZip(p, opts) {
  const notes = exportNotes(p, opts);
  await ensureShots(notes);
  const base = `${safeFileName(p.title)}_правки`;
  // Внутри архива — латиница: кириллические имена ломаются в части архиваторов на Windows и в мессенджерах
  const dir = `${translit(safeFileName(p.title)) || 'video'}_edits`;
  const files = [
    { name: `${dir}/prompt_for_agent.md`, data: buildAgentPrompt(p, opts) },
    { name: `${dir}/report.html`, data: buildReport(p, opts, (n, i) => shotName(n, i)) },
    { name: `${dir}/notes.json`, data: buildExport(p, 'json', { ...opts, ms: true }) },
  ];
  notes.forEach((n, i) => {
    const url = n.shot && shots.cache.get(n.id);
    if (url) files.push({ name: `${dir}/${shotName(n, i)}`, data: dataUrlBytes(url) });
  });
  const blob = makeZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base}_${stamp()}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Архив готов: ${notesWord(notes.length)}, ${files.length - 3} ${plural(files.length - 3, ['кадр', 'кадра', 'кадров'])}`, { kind: 'ok' });
}

function openExport() {
  const p = state.project;
  if (!p) return;
  if (!p.notes.length) {
    toast('Пока нечего сохранять — добавь хотя бы одну правку');
    return;
  }
  const o = state.settings.export;
  if (!FORMATS.some((f) => f.id === o.format)) o.format = 'html';
  el.formatSeg.innerHTML = FORMATS.map((f) => `<button data-format="${f.id}" class="${o.format === f.id ? 'on' : ''}">${f.label}</button>`).join('');
  const counts = new Map();
  p.notes.forEach((n) => counts.set(n.type, (counts.get(n.type) || 0) + 1));
  el.exportTypes.innerHTML = [...counts].map(([t, c]) => `
    <button class="type-chip ${o.excluded.includes(t) ? '' : 'on'}" data-type="${esc(t)}" style="--c:${typeColor(t)}">
      ${esc(t)} <span class="num">${c}</span>
    </button>`).join('');
  el.optShowType.checked = o.showType;
  el.optHideDone.checked = o.hideDone;
  el.optMs.checked = o.ms;
  el.optLinks.checked = o.links;
  el.optHeader.checked = o.header;
  el.optLinksRow.hidden = p.kind !== 'youtube';
  el.pathRow.hidden = p.kind !== 'file';
  if (p.kind === 'file' && !p.path && state.settings.lastDir) p.path = `${state.settings.lastDir}/${p.name}`;
  el.optPath.value = p.path || '';
  el.exportShareBtn.disabled = typeof CompressionStream === 'undefined';
  el.exportDialog.showModal();
  updateExportPreview();
}

let previewToken = 0;
async function updateExportPreview() {
  const p = state.project;
  const o = state.settings.export;
  const f = FORMATS.find((x) => x.id === o.format);
  const notes = exportNotes(p, o);
  const token = ++previewToken;
  const isHtml = o.format === 'html';

  el.exportSummary.textContent = notes.length === p.notes.length ? notesWord(notes.length) : `${notes.length} из ${p.notes.length}`;
  el.exportCopyBtn.hidden = isHtml;
  el.exportOpenBtn.hidden = !isHtml;
  el.exportCopyBtn.textContent = o.format === 'agent' ? 'Копировать промпт' : 'Копировать';
  el.exportDownloadBtn.textContent = isHtml ? 'Скачать отчёт' : `Скачать .${f.ext}`;
  el.exportDownloadBtn.classList.toggle('btn-primary', isHtml);
  [el.exportCopyBtn, el.exportDownloadBtn, el.exportOpenBtn, el.exportZipBtn].forEach((b) => { b.disabled = !notes.length; });
  // «Миллисекунды» и «Название сверху» в отчёте и промпте решены за тебя
  el.optHeader.closest('.check').hidden = isHtml || o.format === 'agent';
  el.optMs.closest('.check').hidden = o.format === 'agent';

  if (!notes.length) {
    el.exportFrame.hidden = true;
    el.exportPreview.hidden = false;
    el.exportPreview.textContent = 'Под выбранные фильтры не попала ни одна правка';
    return;
  }
  if (isHtml) {
    await ensureShots(notes);
    if (token !== previewToken) return;
    el.exportPreview.hidden = true;
    el.exportFrame.hidden = false;
    el.exportFrame.srcdoc = buildReport(p, o);
    return;
  }
  el.exportFrame.hidden = true;
  el.exportPreview.hidden = false;
  el.exportPreview.textContent = exportText(p, o.format, o);
}

function exportText(p, format, opts) {
  return format === 'agent' ? buildAgentPrompt(p, opts) : buildExport(p, format, opts);
}

function onExportOptionChange() {
  const o = state.settings.export;
  o.showType = el.optShowType.checked;
  o.hideDone = el.optHideDone.checked;
  o.ms = el.optMs.checked;
  o.links = el.optLinks.checked;
  o.header = el.optHeader.checked;
  saveSettings();
  updateExportPreview();
}

async function downloadExport(p, format, opts) {
  const f = FORMATS.find((x) => x.id === format);
  const base = safeFileName(p.title);
  if (format === 'html') {
    await ensureShots(exportNotes(p, opts));
    download(buildReport(p, opts), `${base}_отчёт_${stamp()}.html`, f.mime);
    return;
  }
  let content = exportText(p, format, opts);
  if (format === 'csv') content = '﻿' + content; // BOM, чтобы Excel не ломал кириллицу
  const suffix = format === 'agent' ? 'для_агента' : 'правки';
  download(content, `${base}_${suffix}_${stamp()}.${f.ext}`, f.mime);
}

async function openReportTab(p, opts) {
  await ensureShots(exportNotes(p, opts));
  const url = URL.createObjectURL(new Blob([buildReport(p, opts)], { type: 'text/html;charset=utf-8' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** «Копировать всё» — текстом, со всеми правками, без фильтров */
async function copyAll(p = state.project) {
  if (!p?.notes.length) return;
  const o = { ...state.settings.export, excluded: [], hideDone: false };
  const ok = await copyText(buildExport(p, 'txt', o));
  toast(ok ? `Скопировано: ${notesWord(p.notes.length)}` : 'Не получилось скопировать', { kind: ok ? 'ok' : 'error' });
}

/* ---------- ссылка с правками ---------- */

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Для ссылки: координаты до сотых, точки карандаша прореживаем — на глаз не отличить, а ссылка в разы короче */
function compactShapes(shapes) {
  if (!shapes) return 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  return shapes.map((sh) => {
    if (sh.t !== 'pen') return { ...sh, p: sh.p.map(r2) };
    const pts = [r2(sh.p[0]), r2(sh.p[1])];
    for (let i = 2; i < sh.p.length; i += 2) {
      const last = sh.p.length - 2 === i;
      if (last || Math.hypot(sh.p[i] - pts[pts.length - 2], sh.p[i + 1] - pts[pts.length - 1]) >= 0.02) pts.push(r2(sh.p[i]), r2(sh.p[i + 1]));
    }
    return { ...sh, p: pts };
  });
}

// Telegram режет сообщения длиннее 4096 символов, часть мессенджеров — ещё раньше
const LINK_SAFE_LENGTH = 3500;

async function makeShareLink(p) {
  const r = (x) => Math.round(x * 100) / 100;
  const payload = {
    v: 1,
    k: p.kind,
    n: p.kind === 'file' ? p.name : undefined,
    t: p.title,
    y: p.ytId || undefined,
    u: p.kind === 'url' ? p.url : undefined,
    vt: p.vertical ? 1 : undefined,
    ns: p.notes.map((n) => [r(n.seconds), n.end !== null ? r(n.end) : 0, n.type, n.text, n.done ? 1 : 0, compactShapes(n.shapes)]),
  };
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${location.origin}${location.pathname}#s=${b64url(bytes)}`;
}

async function readShareLink(hash) {
  const stream = new Blob([unb64url(hash)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const d = JSON.parse(await new Response(stream).text());
  if (d.v !== 1 || !Array.isArray(d.ns)) throw new Error('bad payload');
  const src = d.k === 'youtube' ? { kind: 'youtube', id: d.y, url: d.vt ? `https://youtube.com/shorts/${d.y}` : `https://youtu.be/${d.y}`, vertical: !!d.vt }
    : d.k === 'url' ? { kind: 'url', url: d.u, title: d.t }
    : { kind: 'file', name: d.n, title: d.t || d.n };
  const notes = d.ns.map(([s, e, type, text, done, shapes]) => normalizeNote({ seconds: s, end: e || null, type, text, done: !!done, shapes: shapes || null }));
  return { src, title: d.t, notes };
}

/** Слить правки в проект: одинаковые (момент + текст) не дублируем. shotData — кадры из бэкапа по id правки */
function mergeNotes(key, base, incoming, shotData = {}) {
  const p = readProject(key) || blankProject(base, key);
  if (base.title && (!p.title || p.title === p.name || p.title === 'YouTube')) p.title = base.title;
  const seen = new Set(p.notes.map((n) => `${n.seconds.toFixed(1)}|${n.text}`));
  let added = 0;
  for (const n of incoming) {
    const sig = `${n.seconds.toFixed(1)}|${n.text}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const id = n.id && !p.notes.some((x) => x.id === n.id) ? n.id : uid();
    const img = shotData[n.id];
    if (img) shots.put(id, img);
    p.notes.push({ ...n, id, shot: !!img || (n.shot && id === n.id) });
    added++;
    if (!state.types.includes(n.type)) state.types.push(n.type);
  }
  sortNotes(p.notes);
  p.updatedAt = Date.now();
  store.set(key, serialize(p));
  saveTypes();
  return added;
}

async function handleShareHash() {
  const m = location.hash.match(/^#s=([\w-]+)/);
  if (!m) return;
  try {
    const data = await readShareLink(m[1]);
    state.pendingImport = data;
    const where = data.src.kind === 'file'
      ? `После этого выбери у себя файл «${data.src.name}».`
      : 'Видео откроется сразу.';
    el.importText.innerHTML = `К видео <b>${esc(data.title || 'без названия')}</b> — ${esc(notesWord(data.notes.length))}. Сохраню их у тебя в браузере. ${esc(where)}`;
    el.importDialog.showModal();
  } catch {
    toast('Ссылка с правками повреждена', { kind: 'error' });
  }
  history.replaceState(null, '', location.pathname + location.search);
}

function confirmImport() {
  const data = state.pendingImport;
  if (!data) return;
  state.pendingImport = null;
  el.importDialog.close();
  const key = keyFor(data.src);
  const added = mergeNotes(key, data.src, data.notes);
  renderLibraryCount();
  toast(added ? `Добавлено: ${notesWord(added)}` : 'Все эти правки у тебя уже есть', { kind: 'ok' });
  if (data.src.kind === 'file') {
    state.attachKey = key;
    showStart({ hint: `Выбери файл «${data.src.name}» — правки подтянутся сами.` });
  } else {
    openSource(data.src);
  }
}

/* ---------- все видео: выгрузка и бэкап ---------- */

function renderLibrary() {
  const list = allProjects();
  el.libraryList.innerHTML = list.length
    ? list.map((p) => vidRowHTML(p)).join('')
    : '<p class="empty-lib">Здесь появятся видео, к которым ты писал правки.</p>';
  el.exportAllMdBtn.disabled = !list.length;
  el.backupBtn.disabled = !list.length;
}

function exportAllMarkdown() {
  const o = { ...state.settings.export, excluded: [], hideDone: false, header: false };
  const parts = allProjects().filter((p) => p.notes.length).map((p) =>
    [`## ${p.title}`, '', ...(p.url ? [`Видео: ${p.url}`, ''] : []), buildExport(p, 'md', o)].join('\n'));
  download(`# Правки к видео\n\n${parts.join('\n\n')}\n`, `все_правки_${stamp()}.md`, 'text/markdown');
}

async function backupAll() {
  const projects = {};
  const shotData = {};
  for (const k of store.projectKeys()) {
    projects[k] = store.get(k);
    for (const n of projects[k]?.notes || []) {
      if (!n.shot) continue;
      const img = await shots.get(n.id);
      if (img) shotData[n.id] = img;
    }
  }
  download(JSON.stringify({ app: 'videonotes', version: 2, exportedAt: new Date().toISOString(), types: state.types, projects, shots: shotData }, null, 2),
    `videonotes_backup_${stamp()}.json`, 'application/json');
}

/* ---------- импорт: архив .zip или notes.json из выгрузки ---------- */

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) {
      // Архив, пересобранный Finder или архиватором, — уже сжатый
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}

function bytesToDataUrl(bytes, mime = 'image/jpeg') {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

const isPackageFile = (f) => !!f && /\.(json|zip)$/i.test(f.name);

/** Перетащили или выбрали архив / notes.json: правки, кадры и путь — к себе, видео — открыть */
async function importPackage(file) {
  let data;
  const shotFiles = {};
  try {
    if (/\.zip$/i.test(file.name)) {
      const entries = await unzip(await file.arrayBuffer());
      const jsonName = [...entries.keys()].find((n) => /(^|\/)notes\.json$/.test(n));
      if (!jsonName) {
        toast('В архиве нет notes.json — это точно архив из Video Notes?', { kind: 'error' });
        return;
      }
      data = JSON.parse(new TextDecoder().decode(entries.get(jsonName)));
      const dir = jsonName.slice(0, -'notes.json'.length);
      for (const [n, b] of entries) if (n.startsWith(`${dir}shots/`)) shotFiles[n.slice(dir.length)] = b;
    } else {
      data = JSON.parse(await file.text());
    }
  } catch {
    toast('Не получилось прочитать файл', { kind: 'error' });
    return;
  }

  if (data?.app === 'videonotes') return restoreBackup(data);
  if (!data?.video || !Array.isArray(data.notes)) return restoreBackup(data);

  const v = data.video;
  const src = v.kind === 'youtube' ? parseSource(v.url)
    : v.kind === 'url' ? { kind: 'url', url: v.url, title: v.title }
    : { kind: 'file', name: v.file || v.title, title: v.title || v.file };
  if (!src || src.kind === 'error' || (src.kind === 'file' && !src.name)) {
    toast('В файле не нашлось, к какому видео эти правки', { kind: 'error' });
    return;
  }
  const shotData = {};
  const notes = data.notes.map((n) => {
    const id = uid();
    if (n.shot && shotFiles[n.shot]) shotData[id] = bytesToDataUrl(shotFiles[n.shot]);
    return normalizeNote({
      id,
      seconds: n.startSeconds ?? n.seconds,
      end: n.endSeconds ?? null,
      type: n.type || state.types[0],
      text: n.text,
      done: n.done,
      shapes: n.marks || n.shapes,
      shot: !!shotData[id],
    });
  }).filter(Boolean);

  const key = keyFor(src);
  const added = mergeNotes(key, src, notes, shotData);
  if (v.path || v.durationSeconds || v.description || v.sources || v.status) {
    const p = readProject(key);
    if (v.path && !p.path) p.path = v.path;
    if (v.durationSeconds && !p.duration) p.duration = v.durationSeconds;
    if (v.description && !p.desc) p.desc = v.description;
    if (Array.isArray(v.sources) && !p.sources) p.sources = v.sources.join('\n');
    if (STATUSES[v.status] && p.status === DEFAULT_STATUS) p.status = v.status;
    store.set(key, serialize(p));
  }
  renderLibraryCount();
  el.libraryDialog.open && el.libraryDialog.close();
  toast(added ? `Загружено: ${notesWord(added)}` : 'Все эти правки у тебя уже есть', { kind: 'ok' });

  if (state.project?.key === key && player.mode) {
    const fresh = readProject(key);
    Object.assign(state.project, { notes: fresh.notes, path: fresh.path, desc: fresh.desc, sources: fresh.sources, status: fresh.status });
    renderTypes();
    renderNotes();
    renderTimeline();
    preloadShots(state.project);
    showWorkspace();
    renderSource();
  } else if (src.kind === 'file') {
    state.attachKey = key;
    showStart({ hint: `Правки загружены. Выбери файл «${src.name}»${v.path ? ` (он лежал тут: ${v.path})` : ''} — они подтянутся сами.` });
  } else {
    openSource(src);
  }
}

async function restoreBackup(fileOrData) {
  let data = fileOrData;
  if (fileOrData instanceof Blob) {
    try {
      data = JSON.parse(await fileOrData.text());
    } catch {
      toast('Это не JSON', { kind: 'error' });
      return;
    }
  }
  let added = 0;
  if (data?.app === 'videonotes' && data.projects) {
    (data.types || []).forEach((t) => { if (!state.types.includes(t)) state.types.push(t); });
    for (const [key, raw] of Object.entries(data.projects)) {
      if (!key.startsWith(PREFIX) || key === TYPES_KEY) continue;
      const tmp = `__restore__${key}`;
      localStorage.setItem(tmp, JSON.stringify(raw));
      const parsed = readProject(tmp);
      localStorage.removeItem(tmp);
      if (!parsed) continue;
      added += mergeNotes(key, { kind: parsed.kind, title: parsed.title, url: parsed.url, id: parsed.ytId, name: parsed.name, vertical: parsed.vertical }, parsed.notes, data.shots || {});
    }
  } else if (state.project && (Array.isArray(data) || Array.isArray(data?.notes))) {
    // Выгрузка одного видео в JSON (старый или новый формат) — в текущее видео
    const raw = Array.isArray(data) ? data : data.notes;
    const notes = raw.map((n) => normalizeNote({ ...n, seconds: n.seconds ?? n.startSeconds, end: n.endSeconds ?? n.end })).filter(Boolean);
    added = mergeNotes(state.project.key, state.project, notes);
  } else {
    toast('Не узнала формат файла', { kind: 'error' });
    return;
  }
  if (state.project) {
    const fresh = readProject(state.project.key);
    if (fresh) state.project.notes = fresh.notes;
    renderTypes();
    renderNotes();
    renderTimeline();
  }
  renderLibrary();
  renderRecent();
  toast(`Загружено: ${notesWord(added)}`, { kind: 'ok' });
}

/* ============================================================
   СОБЫТИЯ
============================================================ */

function bind() {
  // Источник
  el.urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (openSource(parseSource(el.urlInput.value))) el.urlInput.value = '';
  });
  el.fileInput.addEventListener('change', () => {
    const f = el.fileInput.files[0];
    el.fileInput.value = '';
    if (isPackageFile(f)) importPackage(f);
    else if (f) openFile(f);
  });
  // Импорт правок: архив .zip или notes.json из выгрузки Video Notes
  el.importBtn.addEventListener('click', () => el.importInput.click());
  el.importInput.addEventListener('change', () => {
    const f = el.importInput.files[0];
    el.importInput.value = '';
    if (!f) return;
    if (isPackageFile(f)) importPackage(f);
    else toast('Нужен архив .zip или notes.json, выгруженный из Video Notes', { kind: 'error' });
  });
  el.backToVideoBtn.addEventListener('click', () => { state.attachKey = null; showWorkspace(); renderSource(); });
  el.changeSourceBtn.addEventListener('click', () => showStart());

  // Перетаскивание файла на окно
  let dragDepth = 0;
  const hasPayload = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/uri-list');
  window.addEventListener('dragenter', (e) => {
    if (!hasPayload(e)) return;
    dragDepth++;
    el.dragOverlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.dragOverlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => { if (hasPayload(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasPayload(e)) return;
    e.preventDefault();
    dragDepth = 0;
    el.dragOverlay.hidden = true;
    const file = e.dataTransfer.files[0];
    if (isPackageFile(file)) return importPackage(file);
    if (file) return openFile(file);
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url) openSource(parseSource(url.split('\n')[0]));
  });

  // ⌘V: файл или ссылка из буфера (вне полей ввода)
  document.addEventListener('paste', (e) => {
    const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
    const file = [...(e.clipboardData?.files || [])].find(isVideoFile);
    if (file && e.target !== el.noteInput) {
      e.preventDefault();
      return openFile(file);
    }
    if (inField && e.target !== el.urlInput) return;
    const text = e.clipboardData?.getData('text') || '';
    const src = parseSource(text);
    if (src && src.kind !== 'error' && /^https?:\/\//i.test(text.trim())) {
      e.preventDefault();
      if (openSource(src)) el.urlInput.value = '';
    }
  });

  // Шапка
  el.exportBtn.addEventListener('click', openExport);
  el.libraryBtn.addEventListener('click', () => { renderLibrary(); el.libraryDialog.showModal(); });
  el.recentAllBtn.addEventListener('click', () => { renderLibrary(); el.libraryDialog.showModal(); });
  el.hotkeysBtn.addEventListener('click', () => el.hotkeysDialog.showModal());
  $('#modeToggle').addEventListener('click', toggleReading);
  el.themeBtn.addEventListener('click', cycleTheme);
  el.statusBtn.addEventListener('click', toggleStatusMenu);

  // Списки видео (недавние и «Мои видео»)
  const onVidList = (e) => {
    const btn = e.target.closest('[data-act]');
    const row = e.target.closest('.vid-row');
    if (!btn || !row) return;
    const key = row.dataset.key;
    if (btn.dataset.act === 'open') openFromLibrary(key);
    if (btn.dataset.act === 'delete') deleteProject(key);
    if (btn.dataset.act === 'copy') copyAll(readProject(key));
  };
  el.recentList.addEventListener('click', onVidList);
  el.libraryList.addEventListener('click', onVidList);
  el.exportAllMdBtn.addEventListener('click', exportAllMarkdown);
  el.backupBtn.addEventListener('click', backupAll);
  el.restoreInput.addEventListener('change', () => {
    const f = el.restoreInput.files[0];
    el.restoreInput.value = '';
    if (f) importPackage(f);
  });

  // Плеер
  el.playBtn.addEventListener('click', () => player.toggle());
  el.muteBtn.addEventListener('click', () => player.toggleMute());
  el.fullscreenBtn.addEventListener('click', toggleFullscreen);
  // Без нативных контролов клик по видео — пауза/пуск (кроме режима обводки: там холст сверху)
  el.video.addEventListener('click', () => player.toggle());
  el.video.addEventListener('dblclick', toggleFullscreen);
  el.ytHost.addEventListener('click', () => player.toggle());
  el.ytHost.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => paintLayer()));
  el.backBtn.addEventListener('click', () => player.seek(player.time() - 5));
  el.fwdBtn.addEventListener('click', () => player.seek(player.time() + 5));
  el.speedSeg.innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('');
  el.speedSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    state.settings.speed = +b.dataset.speed;
    saveSettings();
    player.setRate(state.settings.speed);
    renderSpeed();
  });
  el.video.addEventListener('ratechange', () => {
    if (el.video.playbackRate !== state.settings.speed && player.mode === 'video') {
      state.settings.speed = el.video.playbackRate;
      renderSpeed();
    }
  });
  el.autopauseToggle.checked = state.settings.autopause;
  el.autopauseToggle.addEventListener('change', () => {
    state.settings.autopause = el.autopauseToggle.checked;
    saveSettings();
  });

  // Таймлайн в два этажа. Сверху прогресс: клик и протягивание перематывают видео.
  // Снизу дорожка правок: метки, выделение куска протягиванием; видео она не двигает
  let suppressClick = false;
  let scrubbing = false;
  let lastScrub = 0;
  el.tlTrack.addEventListener('pointerdown', (e) => {
    if (!state.dur || e.button !== 0) return;
    scrubbing = true;
    el.tlTrack.setPointerCapture(e.pointerId);
    player.seek(timelineTime(e).t);
  });
  el.tlTrack.addEventListener('pointermove', (e) => {
    if (!scrubbing || Date.now() - lastScrub < 60) return;
    lastScrub = Date.now();
    player.seek(timelineTime(e).t);
  });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    if (e?.clientX !== undefined) player.seek(timelineTime(e).t);
  };
  el.tlTrack.addEventListener('pointerup', endScrub);
  el.tlTrack.addEventListener('pointercancel', () => { scrubbing = false; });

  el.tlLane.addEventListener('pointerdown', (e) => {
    if (!state.dur || e.button !== 0 || e.target.closest('.tl-mark')) return;
    state.selecting = { t0: timelineTime(e).t, x0: e.clientX, moved: false, wasPlaying: !player.paused() };
    el.tlLane.setPointerCapture(e.pointerId);
  });
  el.tlLane.addEventListener('pointermove', (e) => {
    const sel = state.selecting;
    if (!sel) return;
    if (!sel.moved && Math.abs(e.clientX - sel.x0) < 5) return;
    if (!sel.moved) {
      sel.moved = true;
      player.pause();
    }
    const { t } = timelineTime(e);
    state.markIn = Math.min(sel.t0, t);
    state.markOut = Math.max(sel.t0, t);
    renderSelection();
    renderComposer();
  });
  const endSelect = () => {
    const sel = state.selecting;
    state.selecting = null;
    if (!sel?.moved) return;
    suppressClick = true;
    if (state.markOut - state.markIn < 0.3) {
      state.markIn = null;
      state.markOut = null;
    } else {
      if (sel.wasPlaying && state.settings.autopause) state.pausedByComposer = true;
      else if (sel.wasPlaying) player.play();
      focusNote();
    }
    renderSelection();
    renderComposer();
  };
  el.tlLane.addEventListener('pointerup', () => {
    const moved = state.selecting?.moved;
    endSelect();
    if (moved) el.tlTip.hidden = true; // после протягивания курсор часто уже не над дорожкой
  });
  el.tlLane.addEventListener('pointercancel', endSelect);
  el.tlLane.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (!state.dur) return;
    const mark = e.target.closest('.tl-mark');
    if (mark) {
      const n = findNote(mark.dataset.id);
      if (!n) return;
      seekToNote(n);
      if (state.filter !== 'all' && state.filter !== n.type) { state.filter = 'all'; renderNotes(); }
      const node = el.notesList.querySelector(`[data-id="${n.id}"]`);
      scrollToNote(node);
      node?.classList.remove('flash');
      void node?.offsetWidth;
      node?.classList.add('flash');
      return;
    }
    // Отрезок выделен — клик по дорожке его сбрасывает; без отрезка — переходим в этот момент
    if (state.markIn !== null) clearRange();
    else player.seek(timelineTime(e).t);
    showTimelineTip(e);
  });
  const showTimelineTip = (e) => {
    if (!state.dur) return;
    const mark = e.target.closest('.tl-mark');
    const n = mark && findNote(mark.dataset.id);
    const { t, x } = timelineTime(e);
    // Превью кадра: под меткой — момент правки, иначе — место под курсором
    const thumbOk = player.mode === 'video' && el.tlThumb.videoWidth > 0;
    el.tlThumb.hidden = !thumbOk;
    if (thumbOk) thumbSeek(n ? n.seconds : t);
    const onLane = !!e.target.closest('.tl-lane');
    // Полоска-указатель на дорожке правок (над меткой не нужна — там клик ведёт к правке)
    el.tlGuide.hidden = !(onLane || state.selecting) || !!n;
    if (!el.tlGuide.hidden) el.tlGuide.style.left = (t / state.dur) * 100 + '%';
    el.tlTipText.innerHTML = n ? `<b>${fmt(n.seconds)}</b>${esc(n.text || n.type)}`
      : state.selecting?.moved ? `<b>${fmt(state.markIn)} → ${fmt(state.markOut)}</b>`
      : !onLane ? `<b>${fmt(t)}</b>`
      : state.markIn !== null ? `<b>${fmt(t)}</b><span class="muted">клик — сбросить отрезок</span>`
      : `<b>${fmt(t)}</b><span class="muted">протяни — выделить кусок</span>`;
    // Подсказка по центру курсора, но не вылезает за края карты
    el.tlTip.hidden = false;
    const w = el.timeline.clientWidth;
    const tw = el.tlTip.offsetWidth;
    el.tlTip.style.left = clamp(x - tw / 2, 8, Math.max(8, w - tw - 8)) + 'px';
  };
  el.timeline.addEventListener('mousemove', showTimelineTip);
  el.timeline.addEventListener('mouseleave', () => { el.tlTip.hidden = true; el.tlGuide.hidden = true; });

  // Обводка на кадре
  el.drawBtn.addEventListener('click', () => openDraw());
  el.drawTools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) { draw.tool = state.settings.drawTool = b.dataset.tool; saveSettings(); renderDrawBar(); }
  });
  el.drawColors.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (b) { draw.color = state.settings.drawColor = b.dataset.color; saveSettings(); renderDrawBar(); }
  });
  el.drawUndo.addEventListener('click', undoShape);
  el.drawCancel.addEventListener('click', clearShapes);
  el.drawDone.addEventListener('click', closeDraw);
  el.drawCapture.addEventListener('click', () => (tabCap.video ? tabCap.stop() : tabCap.start()));
  el.drawLayer.addEventListener('pointerdown', (e) => {
    if (!draw.active || e.button !== 0) return;
    e.preventDefault();
    el.drawLayer.setPointerCapture(e.pointerId);
    const [x, y] = layerPoint(e);
    draw.cur = { t: draw.tool, c: draw.color, p: draw.tool === 'pen' ? [x, y] : [x, y, x, y] };
    paintLayer();
  });
  el.drawLayer.addEventListener('pointermove', (e) => {
    const c = draw.cur;
    if (!c) return;
    const [x, y] = layerPoint(e);
    if (c.t === 'pen') {
      const n = c.p.length;
      if (Math.hypot(x - c.p[n - 2], y - c.p[n - 1]) > 0.003) c.p.push(x, y);
    } else {
      c.p[2] = x;
      c.p[3] = y;
    }
    paintLayer();
  });
  const endShape = () => {
    const c = draw.cur;
    draw.cur = null;
    if (!c) return;
    const big = c.t === 'pen' ? c.p.length >= 6 : Math.hypot(c.p[2] - c.p[0], c.p[3] - c.p[1]) > 0.015;
    if (big) draw.shapes.push(normShapes([c])[0]);
    renderDrawBar();
    paintLayer();
    if (!big) return;
    commitDraw();
    if (!draw.target) focusNote(); // можно сразу писать текст, рисовать мышью это не мешает
  };
  el.drawLayer.addEventListener('pointerup', endShape);
  el.drawLayer.addEventListener('pointercancel', endShape);
  window.addEventListener('resize', () => paintLayer());

  el.attachEdit.addEventListener('click', () => openDraw());
  el.attachRemove.addEventListener('click', () => {
    state.attach = null;
    renderAttach();
    if (!el.noteInput.value.trim() && state.markIn === null) state.pending = null;
    renderComposer();
  });
  el.shotSeekBtn.addEventListener('click', () => {
    const n = findNote(el.shotDialog.dataset.id);
    el.shotDialog.close();
    if (n) { player.seek(n.seconds); player.pause(); }
  });
  el.shotEditBtn.addEventListener('click', () => {
    const n = findNote(el.shotDialog.dataset.id);
    el.shotDialog.close();
    if (n) { player.seek(n.seconds, { follow: false }); openDraw({ target: n.id }); }
  });

  // Новая правка
  el.typeChips.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { e.stopPropagation(); return removeType(rm.dataset.remove); }
    if (e.target.closest('#typeAddBtn')) return startAddType();
    const chip = e.target.closest('[data-type]');
    if (chip) { selectType(chip.dataset.type); focusNote(); }
  });
  el.noteInput.addEventListener('input', onComposerInput);
  el.noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      addNote();
    }
  });
  el.addBtn.addEventListener('click', addNote);
  el.stamp.addEventListener('click', stampToNow);
  el.stampNowBtn.addEventListener('click', stampToNow);
  el.rangeBtn.addEventListener('click', () => {
    if (state.markIn === null) { markIn(); focusNote(); }
    else markOut();
  });
  el.rangeClearBtn.addEventListener('click', clearRange);

  // Список правок
  el.filters.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    state.filter = b.dataset.filter;
    renderNotes();
  });
  el.notesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    const node = e.target.closest('.note');
    if (!btn || !node) return;
    const n = findNote(node.dataset.id);
    if (!n) return;
    if (btn.closest('.note-menu')) closeNoteMenu();
    switch (btn.dataset.act) {
      case 'menu': toggleNoteMenu(node, n); break;
      case 'seek': seekToNote(n); break;
      case 'done':
        n.done = !n.done;
        saveProject();
        renderNotes();
        renderTimeline();
        break;
      case 'retime': {
        const len = n.end !== null ? n.end - n.seconds : null;
        n.seconds = player.time();
        if (len !== null) n.end = n.seconds + len;
        sortNotes(state.project.notes);
        saveProject();
        renderNotes({ flash: n.id });
        renderTimeline();
        break;
      }
      case 'delete': deleteNote(n.id); break;
      case 'shot': openShot(n); break;
      case 'draw':
        player.seek(n.seconds, { follow: false });
        openDraw({ target: n.id });
        break;
    }
  });
  el.notesList.addEventListener('change', (e) => {
    if (!e.target.matches('.type-select')) return;
    const n = findNote(e.target.closest('.note').dataset.id);
    n.type = e.target.value;
    saveProject();
    renderNotes();
    renderTimeline();
  });
  el.notesList.addEventListener('input', (e) => {
    if (!e.target.matches('.note-text')) return;
    const n = findNote(e.target.closest('.note').dataset.id);
    n.text = e.target.value;
    autosize(e.target);
    saveSoon();
  });
  el.notesList.addEventListener('focusout', (e) => {
    if (e.target.matches('.note-text')) { clearTimeout(saveTimer); saveProject(); }
  });
  el.copyAllBtn.addEventListener('click', () => copyAll());

  // Описание к публикации
  el.panelTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setPanelTab(b.dataset.tab);
  });
  // Текст: расшифровка и выделение слов протягиванием
  el.textRunBtn.addEventListener('click', transcribe);
  // Язык и модель запоминаем: в следующий раз сразу «Расшифровать»
  el.textModel.value = localStorage.getItem('vn.asrModel') || (asrLimits().light ? 'base' : 'small');
  // По умолчанию русский: автоопределение языка в браузерном Whisper часто уходит в английский
  el.textLang.value = localStorage.getItem('vn.asrLang2') ?? 'russian';
  el.textModel.addEventListener('change', () => localStorage.setItem('vn.asrModel', el.textModel.value));
  el.textLang.addEventListener('change', () => localStorage.setItem('vn.asrLang2', el.textLang.value));
  el.textRedoBtn.addEventListener('click', () => {
    tr.redo = !tr.redo;
    renderTranscript();
    if (tr.redo) el.textStart.scrollIntoView({ block: 'nearest' });
  });
  el.textCancelBtn.addEventListener('click', () => cancelTranscribe({ user: true }));
  el.words.addEventListener('pointerdown', onWordsDown);
  el.words.addEventListener('pointermove', onWordsMove);
  el.words.addEventListener('pointerup', onWordsUp);
  el.words.addEventListener('pointercancel', onWordsUp);
  el.capView.addEventListener('wheel', (e) => {
    if (!tr.spans.length) return;
    e.preventDefault();
    shiftLines(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  new ResizeObserver(() => { const s = spanOf(tr.cur); if (s && !tr.manual) showLine(lineOf(s)); }).observe(el.capView);
  // Видео ужимается на высоту текста — три строки всегда видны без прокрутки
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--cap-h', el.captions.hidden ? '0px' : `${el.captions.offsetHeight + 22}px`);
  }).observe(el.captions);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tr.drag) {
      tr.drag = null;
      el.captions.classList.remove('dragging');
      clearWordSel();
      e.stopImmediatePropagation();
    }
  }, true);
  el.descText.addEventListener('input', () => {
    state.project.desc = el.descText.value;
    renderDescMeta();
    saveSoon();
  });
  el.descSources.addEventListener('input', () => {
    state.project.sources = el.descSources.value;
    saveSoon();
  });
  [el.descText, el.descSources].forEach((f) => f.addEventListener('blur', () => { clearTimeout(saveTimer); saveProject(); }));
  el.descCopyBtn.addEventListener('click', async () => {
    const ok = await copyText(state.project.desc || '');
    toast(ok ? 'Текст описания скопирован' : 'Не получилось скопировать', { kind: ok ? 'ok' : 'error' });
  });

  // Выгрузка
  el.formatSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-format]');
    if (!b) return;
    state.settings.export.format = b.dataset.format;
    saveSettings();
    $$('button', el.formatSeg).forEach((x) => x.classList.toggle('on', x === b));
    updateExportPreview();
  });
  el.exportTypes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    const o = state.settings.export;
    const t = b.dataset.type;
    o.excluded = o.excluded.includes(t) ? o.excluded.filter((x) => x !== t) : [...o.excluded, t];
    b.classList.toggle('on', !o.excluded.includes(t));
    saveSettings();
    updateExportPreview();
  });
  [el.optShowType, el.optHideDone, el.optMs, el.optLinks, el.optHeader].forEach((c) => c.addEventListener('change', onExportOptionChange));
  el.exportCopyBtn.addEventListener('click', async () => {
    const o = state.settings.export;
    const ok = await copyText(exportText(state.project, o.format, o));
    toast(ok ? (o.format === 'agent' ? 'Промпт скопирован — вставь его агенту' : 'Скопировано') : 'Не получилось скопировать', { kind: ok ? 'ok' : 'error' });
  });
  el.exportDownloadBtn.addEventListener('click', () => downloadExport(state.project, state.settings.export.format, state.settings.export));
  el.exportZipBtn.addEventListener('click', () => downloadZip(state.project, state.settings.export));
  el.exportOpenBtn.addEventListener('click', () => openReportTab(state.project, state.settings.export));
  let pathTimer = null;
  el.optPath.addEventListener('input', () => {
    const p = state.project;
    p.path = el.optPath.value.trim();
    const dir = p.path.match(/^(.*)[\\/][^\\/]+$/);
    if (dir) { state.settings.lastDir = dir[1]; saveSettings(); }
    clearTimeout(pathTimer);
    pathTimer = setTimeout(() => { saveProject({ touch: false }); updateExportPreview(); }, 300);
  });
  el.exportShareBtn.addEventListener('click', async () => {
    const link = await makeShareLink(state.project);
    const ok = await copyText(link);
    if (!ok) return toast('Не получилось скопировать', { kind: 'error' });
    if (link.length > LINK_SAFE_LENGTH) {
      toast(`Ссылка скопирована, но она длинная (${link.length} символов) — мессенджер может её обрезать. Надёжнее отправить архив .zip: его можно перетащить в Video Notes.`, { kind: 'error', timeout: 9000 });
      return;
    }
    const hint = state.project.kind === 'file' ? ' Получателю понадобится тот же файл, кадров в ссылке нет.' : ' Кадров в ссылке нет — они только в архиве.';
    toast(`Ссылка скопирована.${hint}`, { kind: 'ok', timeout: 6000 });
  });

  // Импорт
  el.importConfirmBtn.addEventListener('click', confirmImport);

  // Модалки: закрытие по крестику и клику по фону
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  });

  document.addEventListener('keydown', onHotkey);
  window.addEventListener('hashchange', handleShareHash);
}

function renderSpeed() {
  $$('button', el.speedSeg).forEach((b) => b.classList.toggle('on', +b.dataset.speed === state.settings.speed));
}

/* ---------- режим чтения: видео узкое, правки широко ---------- */

function applyReading() {
  const on = !!state.settings.reading;
  el.workspace.classList.toggle('reading', on);
  const btn = $('#modeToggle');
  const label = on ? 'Обычный режим (R)' : 'Режим чтения правок (R)';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  requestAnimationFrame(() => paintLayer()); // плеер поменял размер — перерисовать пометки
}

function toggleReading() {
  state.settings.reading = !state.settings.reading;
  saveSettings();
  applyReading();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else el.playerFrame.requestFullscreen?.().catch(() => {});
}

/** videonotes.vkrbt.me/?src=<ссылка на видео>&title=<название> — сразу открыть это видео */
function openFromQuery() {
  if (location.hash.startsWith('#s=')) return;
  const q = new URLSearchParams(location.search);
  const raw = q.get('src');
  if (!raw) return;
  const src = parseSource(raw);
  if (src && src.kind === 'url' && q.get('title')) src.title = q.get('title');
  if (!openSource(src)) return;
  const title = q.get('title');
  if (title && state.project && state.project.title !== title && state.project.title === fileNameFromUrl(state.project.url || '')) {
    state.project.title = title;
    renderSource();
    saveProject({ touch: false });
  }
}

/* ---------- тема ---------- */

const THEME_KEY = 'videonotes::theme';
const THEMES = ['system', 'light', 'dark'];
const THEME_LABELS = { system: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };

function renderThemeBtn() {
  const t = document.documentElement.dataset.theme || 'system';
  el.themeBtn.title = THEME_LABELS[t];
  el.themeBtn.setAttribute('aria-label', THEME_LABELS[t]);
}

function cycleTheme() {
  const cur = document.documentElement.dataset.theme || 'system';
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  document.documentElement.dataset.theme = next;
  if (next === 'system') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, next);
  renderThemeBtn();
  toast(THEME_LABELS[next], { timeout: 1500 });
}

/* ---------- горячие клавиши ---------- */

/** Цифра 1–9 по физической клавише; e.key — запасной путь, если браузер не прислал e.code */
function digitOf(e) {
  if (/^Digit[1-9]$/.test(e.code)) return +e.code.slice(5);
  if (!e.code && /^[1-9]$/.test(e.key)) return +e.key;
  return 0;
}

function onHotkey(e) {
  if ($$('dialog[open]').length) return;
  if (draw.active) {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.code === 'Escape') { e.preventDefault(); closeDraw(); return; }
    if (!typing) {
      if (e.code === 'Enter') { e.preventDefault(); closeDraw(); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); undoShape(); }
      return;
    }
  }
  const mod = e.metaKey || e.ctrlKey;
  const inField = e.target.closest?.('input, textarea, select, [contenteditable]');
  const ready = !!state.project && !el.workspace.hidden;

  if (e.code === 'Escape' && inField) {
    e.target.blur();
    return;
  }
  if (!ready) return;

  if (mod && !e.altKey && !e.shiftKey) {
    if (e.code === 'KeyP') { e.preventDefault(); player.toggle(); return; }
    if (e.code === 'ArrowLeft') { e.preventDefault(); player.seek(player.time() - 1); return; }
    if (e.code === 'ArrowRight') { e.preventDefault(); player.seek(player.time() + 1); return; }
    if (e.code === 'Enter' && e.target === el.noteInput) { e.preventDefault(); addNote(); return; }
    if (e.code === 'KeyS') { e.preventDefault(); openExport(); return; }
    return;
  }

  // ⌥1–9 при наборе — выбрать тип, не выходя из поля
  if (e.target === el.noteInput && e.altKey && digitOf(e)) {
    e.preventDefault();
    const t = state.types[digitOf(e) - 1];
    if (t) selectType(t);
    return;
  }

  if (inField || e.altKey || mod) return;

  const key = (e.shiftKey && e.code === 'Slash') || e.key === '?' ? '?' : e.code;
  const actions = {
    Space: () => player.toggle(),
    KeyK: () => player.toggle(),
    ArrowLeft: () => player.seek(player.time() - 5),
    ArrowRight: () => player.seek(player.time() + 5),
    KeyJ: () => player.seek(player.time() - 10),
    KeyL: () => player.seek(player.time() + 10),
    KeyN: () => focusNote(),
    KeyI: () => markIn(),
    KeyO: () => markOut(),
    KeyE: () => openExport(),
    KeyD: () => openDraw(),
    KeyR: () => toggleReading(),
    KeyM: () => player.toggleMute(),
    KeyF: () => toggleFullscreen(),
    '?': () => el.hotkeysDialog.showModal(),
  };
  if (actions[key]) {
    e.preventDefault();
    actions[key]();
    return;
  }
  if (digitOf(e)) {
    const t = state.types[digitOf(e) - 1];
    if (t) { e.preventDefault(); selectType(t); }
  }
}

/* ---------- старт ---------- */

// Форма сдвигается ровно на столько, на сколько прокрутилась страница — вниз уезжает
// под шапку, вверх возвращается (как адресная строка в мобильном Safari). Без рывков и сюрпризов
const composerCard = $('#composer');
let lastScrollY = window.scrollY;
let composerShift = 0;
const composerTab = $('#composerTab');
function setComposerShift(v) {
  composerShift = v;
  composerCard.style.transform = v ? `translateY(${-v}px)` : '';
  const h = composerCard.offsetHeight;
  composerCard.classList.toggle('peek', v > h * 0.6);
  // Наполовину спрятанная форма не ловит клики и Tab — кроме язычка
  for (const child of composerCard.children) if (child !== composerTab) child.inert = v > h / 2;
}
let composerHoldUntil = 0; // пока страница сама докручивает к правке — форма стоит на месте
window.addEventListener('scroll', () => {
  const y = Math.max(0, window.scrollY);
  const dy = y - lastScrollY;
  lastScrollY = y;
  if (getComputedStyle(composerCard).position !== 'sticky') return;
  if (Date.now() < composerHoldUntil) return;
  // Форма уходит ровно под шапку (20px — отступ до неё), а язычок остаётся торчать
  const max = Math.min(composerCard.offsetHeight + 20, y);
  setComposerShift(clamp(composerShift + dy, 0, max));
}, { passive: true });
function revealComposer() {
  if (!composerShift) return;
  composerCard.classList.add('reveal');
  setComposerShift(0);
  setTimeout(() => composerCard.classList.remove('reveal'), 260);
}
composerCard.addEventListener('focusin', (e) => { if (e.target !== composerTab) revealComposer(); });
composerTab.addEventListener('click', () => focusNote());

/** Докрутить до правки так, чтобы она оказалась под формой, а форма не уехала */
function scrollToNote(node) {
  if (!node) return;
  const sticky = getComputedStyle(composerCard).position === 'sticky';
  const topbar = $('.topbar').offsetHeight;
  const top = sticky ? topbar + 20 + composerCard.offsetHeight + 16 : topbar + 16;
  const bottom = window.innerHeight - 16;
  const r = node.getBoundingClientRect();
  let delta = 0;
  if (r.top < top) delta = r.top - top;
  else if (r.bottom > bottom) delta = Math.min(r.bottom - bottom, r.top - top);
  if (sticky && composerShift) setComposerShift(0);
  if (!delta) return;
  composerHoldUntil = Date.now() + 800;
  window.scrollBy({ top: delta, behavior: 'smooth' });
}

/** Поставить курсор в поле правки — сначала вернуть форму, если она уехала */
function focusNote() {
  revealComposer();
  el.noteInput.focus();
}

// Высота прилипшего поля ввода — для отступа списка и прокрутки к правке
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--composer-h', `${Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight)}px`);
}).observe($('#composer'));

bind();
renderSpeed();
renderThemeBtn();
applyReading();
renderRecent();
renderComposer(0);
handleShareHash();
openFromQuery();
cleanupShots();
