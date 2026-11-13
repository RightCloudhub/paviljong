import { CATEGORY_LABELS, normalizeProjects, selectProjects } from './assets/gallery.mjs';
import { createProjectViewer } from './assets/project-viewer.mjs';

const grid = document.querySelector('#card-grid');
const search = document.querySelector('#project-search');
const sort = document.querySelector('#project-sort');
const resultsCount = document.querySelector('#results-count');
const emptyState = document.querySelector('#empty-state');
const errorState = document.querySelector('#error-state');
const themeToggle = document.querySelector('#theme-toggle');
const aboutDialog = document.querySelector('#about-dialog');
const filterButtons = [...document.querySelectorAll('[data-category]')];
const params = new URLSearchParams(location.search);
const state = {
  projects: [],
  status: 'loading',
  category: Object.hasOwn(CATEGORY_LABELS, params.get('category')) ? params.get('category') : 'all',
  query: (params.get('q') || '').slice(0, 100),
  sort: ['newest', 'oldest', 'name'].includes(params.get('sort')) ? params.get('sort') : 'newest',
};
const cards = new Map();
const projectDialog = document.querySelector('#project-dialog');
const projectViewer = createProjectViewer(projectDialog, {
  getProjects: () => selectProjects(state.projects, state),
});
const previewObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const entry of entries) entry.target.style.setProperty('--preview-scale', entry.contentRect.width / 1200);
}) : null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function expandIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'aria-hidden': 'true', class: 'project-arrow' })) icon.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M7 3H3v4m10-4h4v4m0 6v4h-4M7 17H3v-4');
  icon.append(path);
  return icon;
}

function previewFallback(preview, title) {
  const fallback = element('div', 'preview-fallback');
  fallback.setAttribute('aria-hidden', 'true');
  fallback.append(element('span', '', '</>'), element('span', '', title));
  preview.append(fallback);
}

function mountLivePreview(preview, project) {
  const url = new URL(project.url);
  // Remote sites often block embedding. An explicit thumbnail works for them.
  if (url.origin !== location.origin) {
    previewFallback(preview, project.title);
    return;
  }
  url.searchParams.set('preview', '1');
  const frame = element('iframe');
  frame.title = `${project.title}网页预览`;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('inert', '');
  frame.tabIndex = -1;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  frame.src = url.href;
  preview.append(frame);
  preview.style.setProperty('--preview-scale', (preview.clientWidth || 360) / 1200);
  previewObserver?.observe(preview);
}

function createCard(project) {
  const card = element('article', 'card project-card');
  card.dataset.project = project.id;
  const link = element('a', 'project-link');
  link.href = project.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `在页面内预览项目：${project.title}`);
  link.setAttribute('aria-haspopup', 'dialog');
  link.setAttribute('aria-controls', 'project-dialog');
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (projectViewer.open(project, link)) event.preventDefault();
  });
  const preview = element('div', 'project-preview');
  preview.setAttribute('aria-hidden', 'true');
  if (project.preview) {
    const image = element('img');
    image.src = project.preview;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 1200;
    image.height = 750;
    image.addEventListener('error', () => { image.remove(); mountLivePreview(preview, project); }, { once: true });
    preview.append(image);
  }
  const copy = element('div', 'project-copy');
  const titleRow = element('div', 'project-title-row');
  const previewAction = element('span', 'project-preview-action', '页内预览');
  previewAction.append(expandIcon());
  preview.append(previewAction);
  titleRow.append(element('h3', 'project-title', project.title), expandIcon());
  const bottom = element('div', 'project-bottom');
  const tags = element('div', 'project-tags');
  tags.append(element('span', 'project-tag project-tag--category', CATEGORY_LABELS[project.category]));
  for (const tag of project.tags.slice(0, 2)) tags.append(element('span', 'project-tag', tag));
  const date = element('time', 'project-date', project.date.replaceAll('-', '.'));
  date.dateTime = project.date;
  bottom.append(tags, date);
  copy.append(titleRow, element('p', 'project-description', project.description), bottom);
  link.append(preview, copy);
  card.append(link);
  // Mount only after the node enters the document, so its responsive width is known.
  cards.set(project.id, { card, preview, project });
  return card;
}

function updateFilters() {
  for (const button of filterButtons) {
    const selected = button.dataset.category === state.category;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function updateURL() {
  const url = new URL(location.href);
  for (const key of ['q', 'category', 'sort']) url.searchParams.delete(key);
  if (state.query.trim()) url.searchParams.set('q', state.query.trim());
  if (state.category !== 'all') url.searchParams.set('category', state.category);
  if (state.sort !== 'newest') url.searchParams.set('sort', state.sort);
  // Storage/history may be unavailable in private or embedded contexts.
  try { history.replaceState(null, '', url); } catch {}
}

function render() {
  updateFilters();
  updateURL();
  if (state.status !== 'ready') return;
  const projects = selectProjects(state.projects, state);
  const visible = new Set(projects.map(project => project.id));
  for (const [id, { card }] of cards) card.hidden = !visible.has(id);
  // Only reorder when needed; keep iframe documents alive during search and filtering.
  const ordered = selectProjects(state.projects, { sort: state.sort });
  ordered.forEach((project, index) => {
    const card = cards.get(project.id).card;
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
  });
  emptyState.hidden = projects.length > 0;
  resultsCount.textContent = state.query.trim() || state.category !== 'all'
    ? `${projects.length} 个匹配项目 · 共 ${state.projects.length} 个作品`
    : `${projects.length} 个项目 · 点击卡片，在这里体验`;
}

async function loadProjects() {
  projectViewer.close();
  const retry = document.querySelector('#retry-load');
  state.status = 'loading';
  retry.disabled = true;
  grid.setAttribute('aria-busy', 'true');
  errorState.hidden = true;
  emptyState.hidden = true;
  resultsCount.textContent = '正在整理项目…';
  previewObserver?.disconnect();
  cards.clear();
  grid.replaceChildren(element('div', 'state-panel', '正在加载作品…'));
  try {
    const response = await fetch('./data/projects.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`项目配置读取失败（HTTP ${response.status}）。`);
    state.projects = normalizeProjects(await response.json(), document.baseURI);
    grid.replaceChildren(...state.projects.map(createCard));
    for (const { preview, project } of cards.values()) if (!project.preview) mountLivePreview(preview, project);
    for (const count of document.querySelectorAll('[data-count]')) {
      count.textContent = count.dataset.count === 'all' ? state.projects.length : state.projects.filter(project => project.category === count.dataset.count).length;
    }
    state.status = 'ready';
    render();
  } catch (error) {
    grid.replaceChildren();
    state.projects = [];
    state.status = 'error';
    for (const count of document.querySelectorAll('[data-count]')) count.textContent = '0';
    resultsCount.textContent = '项目列表未加载';
    errorState.hidden = false;
    document.querySelector('#error-message').textContent = location.protocol === 'file:'
      ? '请通过本地 HTTP 服务打开本站，项目列表需要读取 JSON 文件。'
      : error instanceof SyntaxError ? '项目配置不是有效 JSON，请检查 data/projects.json。' : (error.message || '读取失败，请稍后重试。');
  } finally {
    retry.disabled = false;
    grid.setAttribute('aria-busy', 'false');
  }
}

search.value = state.query;
sort.value = state.sort;
updateFilters();
for (const button of filterButtons) button.addEventListener('click', () => { state.category = button.dataset.category; render(); });
search.addEventListener('input', () => { state.query = search.value; render(); });
sort.addEventListener('change', () => { state.sort = sort.value; render(); });
document.querySelector('#reset-filters').addEventListener('click', () => {
  state.category = 'all'; state.query = ''; state.sort = 'newest';
  search.value = ''; sort.value = 'newest'; render(); search.focus();
});
document.querySelector('#retry-load').addEventListener('click', loadProjects);

function syncTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#191b18' : '#fafaf8';
}
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('paviljong-theme', theme); } catch {}
  syncTheme();
});
syncTheme();
for (const button of document.querySelectorAll('[data-open-about]')) button.addEventListener('click', () => aboutDialog.showModal());
document.querySelector('#close-about').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', event => {
  const rect = aboutDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) aboutDialog.close();
});
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || aboutDialog.open || projectDialog.open) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault(); search.focus();
});
if (!previewObserver) window.addEventListener('resize', () => {
  for (const { preview } of cards.values()) preview.style.setProperty('--preview-scale', preview.clientWidth / 1200);
});
document.querySelector('#copyright-year').textContent = new Date().getFullYear();
loadProjects();
