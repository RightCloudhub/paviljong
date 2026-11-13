import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalizeProjects, safeWebURL, selectProjects } from '../assets/gallery.mjs';

const base = 'https://example.github.io/paviljong/';
const project = (overrides = {}) => ({
  id: 'first', title: '配色工坊', description: '生成与复制颜色', category: 'tool',
  tags: ['CSS', 'JavaScript'], date: '2026-11-13', url: 'demos/palette/index.html',
  preview: null, featured: false, ...overrides,
});

test('relative projects and thumbnails stay under the GitHub Pages repository path', () => {
  const [result] = normalizeProjects([project({ preview: 'assets/previews/palette.webp' })], base);
  assert.equal(result.url, `${base}demos/palette/index.html`);
  assert.equal(result.preview, `${base}assets/previews/palette.webp`);
  assert.equal(safeWebURL('demos/palette/index.html', 'https://example.github.io/'), 'https://example.github.io/demos/palette/index.html');
});

test('active-content URLs and URL credentials are rejected before rendering', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test.html', 'https://user:secret@example.com/']) {
    assert.throws(() => normalizeProjects([project({ url })], base));
    assert.throws(() => normalizeProjects([project({ preview: url })], base));
  }
  assert.equal(safeWebURL('https://demo.example/project', base), 'https://demo.example/project');
});

test('malformed metadata, impossible dates and duplicate IDs return useful errors', () => {
  for (const data of [null, {}, [null], [project({ title: '' })], [project({ tags: 'HTML' })], [project({ category: '__proto__' })], [project({ date: '2026-02-30' })], [project({ date: '2026-13-01' })], [project(), project()]]) {
    assert.throws(() => normalizeProjects(data, base));
  }
  assert.doesNotThrow(() => normalizeProjects([project({ date: '2024-02-29' })], base));
  assert.deepEqual(normalizeProjects([], base), []);
});

test('search combines words, case-insensitive tags and categories', () => {
  const data = normalizeProjects([
    project(),
    project({ id: 'second', title: '轨道实验', category: 'interaction', tags: ['Canvas'] }),
  ], base);
  assert.deepEqual(selectProjects(data, { category: 'tool', query: '配色 JAVASCRIPT' }).map(p => p.id), ['first']);
  assert.equal(selectProjects(data, { category: 'interaction', query: '配色' }).length, 0);
  assert.deepEqual(selectProjects(data, { query: '  交互实验 canvas  ' }).map(p => p.id), ['second']);
});

test('date sorting, featured ties and name sorting are stable and preserve source order', () => {
  const source = [
    project({ id: 'old', date: '2024-01-01', title: 'Zebra' }),
    project({ id: 'recent', date: '2026-11-13', title: 'Beta' }),
    project({ id: 'featured', date: '2026-11-13', featured: true, title: 'Alpha' }),
  ];
  const data = normalizeProjects(source, base);
  assert.deepEqual(selectProjects(data).map(p => p.id), ['featured', 'recent', 'old']);
  assert.deepEqual(selectProjects(data, { sort: 'oldest' }).map(p => p.id), ['old', 'featured', 'recent']);
  assert.deepEqual(selectProjects(data, { sort: 'name' }).map(p => p.id), ['featured', 'recent', 'old']);
  assert.deepEqual(data.map(p => p.id), ['old', 'recent', 'featured']);
  assert.equal(source[0].timestamp, undefined);
});

test('all configured project pages and local previews exist with exact filename case', async () => {
  const data = JSON.parse(await readFile(new URL('../data/projects.json', import.meta.url), 'utf8'));
  normalizeProjects(data, base);
  for (const entry of data) {
    for (const target of [entry.url, entry.preview].filter(Boolean)) {
      assert.ok(!target.startsWith('/'), `${entry.id}: ${target} must be relative`);
      await access(new URL(`../${target}`, import.meta.url));
    }
  }
});

test('entry-point resources and ordinary demo links resolve without a domain-root path', async () => {
  const data = JSON.parse(await readFile(new URL('../data/projects.json', import.meta.url), 'utf8'));
  const files = ['index.html', ...data.map(p => p.url)];
  for (const file of files) {
    const url = new URL(`../${file}`, import.meta.url);
    const html = await readFile(url, 'utf8');
    assert.match(html, /<html\b[^>]*lang=/i, `${file}: page language`);
    assert.match(html, /<title>[^<]+<\/title>/i, `${file}: page title`);
    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
      assert.ok(!target.startsWith('/'), `${file}: ${target} escapes repository path`);
      const resolved = new URL(target, url);
      resolved.search = ''; resolved.hash = '';
      await access(fileURLToPath(resolved));
    }
  }
});
