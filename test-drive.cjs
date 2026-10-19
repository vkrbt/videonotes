const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
const id = '142Tl3fUhgOPWPvbl1JsNhxrP9RVJ1Goe';
const original = `https://drive.google.com/file/d/${id}/view`;
function context() {
  const c = vm.createContext({ URL, fileNameFromUrl: (url) => new URL(url).pathname.split('/').pop(), parseTimeParam: () => 0 });
  vm.runInContext(app.slice(app.indexOf('const VIDEO_EXT'), app.indexOf('function isVideoFile')), c);
  return c;
}

test('shared Drive URL keeps original link and resolves to a media stream', () => {
  const c = context();
  const src = c.parseSource(original);
  assert.equal(src.kind, 'url');
  assert.equal(src.url, original);
  assert.equal(src.guessed, false);
  const media = new URL(c.googleDriveVideo(src.url).mediaUrl);
  assert.equal(media.hostname, 'drive.usercontent.google.com');
  assert.equal(media.searchParams.get('id'), id);
  assert.equal(media.searchParams.get('confirm'), 't');
});

test('Drive URL formats and link resource keys are supported', () => {
  const c = context();
  for (const url of [`https://drive.google.com/open?id=${id}`, `https://drive.google.com/uc?id=${id}&export=download`, `https://drive.google.com/file/u/0/d/${id}/preview`, `https://docs.google.com/file/d/${id}/edit`, `https://drive.usercontent.google.com/download?id=${id}`]) {
    assert.equal(c.googleDriveVideo(url).id, id);
  }
  assert.equal(new URL(c.googleDriveVideo(original + '?resourcekey=0-test').mediaUrl).searchParams.get('resourcekey'), '0-test');
  assert.equal(c.parseSource(original.replace('https://', '')).kind, 'url');
});

test('folders, malformed IDs and lookalike domains are not treated as Drive video', () => {
  const c = context();
  assert.equal(c.parseSource('https://drive.google.com/drive/folders/' + id).kind, 'error');
  assert.equal(c.parseSource('https://drive.google.com/file/d/short/view').kind, 'error');
  assert.equal(c.googleDriveVideo(`https://drive.google.com.example.org/file/d/${id}/view`), null);
  assert.equal(c.googleDriveVideo('javascript:alert(1)'), null);
});

test('regular video and YouTube links still work', () => {
  const c = context();
  assert.equal(c.parseSource('https://example.org/movie.mp4').url, 'https://example.org/movie.mp4');
  assert.equal(c.parseSource('https://example.org/movie.mp4').guessed, false);
  assert.equal(c.parseSource('https://youtu.be/Tlekaw1Scno').kind, 'youtube');
});

test('reopening a saved URL project uses Drive media and preserves notes, key and custom title', () => {
  const c = context();
  const saved = { title: 'Наш монтаж', notes: [{ seconds: 12, text: 'Правка' }], url: original };
  c.state = {}; c.player = { stop() {} };
  c.keyFor = (src) => 'notes::url:' + src.url;
  c.readProject = () => saved;
  c.startProject = (p) => { c.state.project = p; };
  c.mountVideo = (url, opts) => { c.mounted = { url, opts }; };
  vm.runInContext(app.slice(app.indexOf('function openSource('), app.indexOf('function blankProject(')), c);
  assert.equal(c.openSource({ kind: 'url', url: original, title: 'view' }), true);
  assert.equal(c.state.project, saved);
  assert.equal(c.state.project.title, 'Наш монтаж');
  assert.equal(c.state.project.notes.length, 1);
  assert.equal(c.mounted.opts.drive, true);
  assert.equal(c.mounted.opts.remote, true);
  assert.equal(new URL(c.mounted.url).hostname, 'videonotes.vkrbt.me');
  assert.equal(new URL(c.mounted.url).pathname, '/api/drive');
  assert.equal(saved.url, original);
});

test('website playback uses the same-origin endpoint and keeps the resource key', () => {
  const c = context();
  c.location = { protocol: 'https:', hostname: 'videonotes.vkrbt.me' };
  const source = c.googleDriveVideo(original + '?resourcekey=0-test');
  assert.equal(source.playbackUrl, '/api/drive?id=' + id + '&resourcekey=0-test');
});
