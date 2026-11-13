import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectViewer } from '../assets/project-viewer.mjs';
import { normalizeProjects, selectProjects } from '../assets/gallery.mjs';

const baseURL = 'https://example.github.io/paviljong/';
const projects = normalizeProjects([
  { id: 'palette', title: '配色工坊', description: '生成配色', category: 'tool', tags: ['CSS'], date: '2026-11-13', url: 'demos/palette/index.html?mode=full#palette', preview: 'assets/previews/palette.svg' },
  { id: 'orbit', title: '轨道实验', description: '轨道交互', category: 'interaction', tags: ['Canvas'], date: '2026-11-12', url: 'demos/orbit/index.html' },
  { id: 'focus', title: '专注时钟', description: '专注计时', category: 'tool', tags: ['JavaScript'], date: '2026-11-11', url: 'demos/focus/index.html' },
], baseURL);

class NodeStub extends EventTarget {
  constructor(document) {
    super();
    this.ownerDocument = document;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  replaceChildren(...children) {
    for (const child of this.children) child.isConnected = false;
    this.children = children;
  }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function fixture({ selected = projects, mobile = false } = {}) {
  const timers = new Map();
  let timerID = 0;
  let currentSelection = selected;
  const classNames = new Set();
  const window = new EventTarget();
  window.setTimeout = callback => { const id = ++timerID; timers.set(id, callback); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.matchMedia = () => ({ matches: mobile });
  let observer;
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(node) { this.target = node; }
    disconnect() { this.target = null; }
  };
  const document = {
    baseURI: baseURL,
    defaultView: window,
    documentElement: { classList: { add: value => classNames.add(value), remove: value => classNames.delete(value) } },
    createElement: () => new NodeStub(document),
  };
  const opener = new NodeStub(document);
  document.activeElement = opener;
  const nodes = Object.fromEntries(['title', 'description', 'canvas', 'frame-host', 'loading', 'error', 'error-message', 'external', 'previous', 'next', 'position', 'close', 'retry'].map(id => [`#viewer-${id}`, new NodeStub(document)]));
  nodes['#viewer-canvas'].clientWidth = 1200;
  nodes['#viewer-canvas'].clientHeight = 600;
  const devices = ['desktop', 'mobile'].map(device => {
    const node = new NodeStub(document);
    node.dataset.viewerDevice = device;
    return node;
  });
  const dialog = new NodeStub(document);
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  dialog.querySelector = selector => nodes[selector];
  dialog.querySelectorAll = () => devices;
  dialog.getBoundingClientRect = () => ({ left: 100, top: 100, right: 1000, bottom: 700 });
  const viewer = createProjectViewer(dialog, { getProjects: () => currentSelection });
  return {
    document, dialog, viewer, opener, devices, nodes, timers, classNames,
    get frame() { return nodes['#viewer-frame-host'].children[0]; },
    get observer() { return observer; },
    setSelection: value => { currentSelection = value; },
    expire: () => { for (const callback of [...timers.values()]) callback(); },
  };
}

test('opening a project embeds its full page, preserves repository paths and focuses the close control', () => {
  const f = fixture();
  assert.equal(f.viewer.open(projects[0], f.opener), true);
  assert.equal(f.dialog.open, true);
  assert.equal(f.frame.src, `${baseURL}demos/palette/index.html?mode=full#palette`);
  assert.equal(f.nodes['#viewer-external'].href, f.frame.src);
  assert.equal(f.nodes['#viewer-title'].textContent, projects[0].title);
  assert.equal(f.document.activeElement, f.nodes['#viewer-close']);
  assert.equal(f.classNames.has('is-viewing-project'), true);
  assert.match(f.frame.getAttribute('sandbox'), /allow-scripts/);
  assert.doesNotMatch(f.frame.getAttribute('sandbox'), /allow-same-origin|allow-top-navigation/);
  assert.equal(f.frame.referrerPolicy, 'no-referrer');
  f.viewer.close();
});

test('navigation follows the current filtered and sorted collection, with stable boundaries', () => {
  const filtered = selectProjects(projects, { category: 'tool', sort: 'oldest' });
  const f = fixture({ selected: filtered });
  f.viewer.open(filtered[0]);
  f.setSelection(projects);
  assert.equal(f.nodes['#viewer-position'].textContent, '1 / 2');
  assert.equal(f.nodes['#viewer-previous'].disabled, true);
  const first = f.frame;
  f.nodes['#viewer-next'].click();
  assert.equal(f.nodes['#viewer-title'].textContent, '配色工坊');
  assert.equal(f.nodes['#viewer-position'].textContent, '2 / 2');
  assert.equal(first.isConnected, false);
  assert.equal(f.nodes['#viewer-next'].disabled, true);
  f.nodes['#viewer-next'].dispatchEvent(new Event('click'));
  assert.equal(f.nodes['#viewer-position'].textContent, '2 / 2');
  f.nodes['#viewer-previous'].click();
  assert.equal(f.nodes['#viewer-title'].textContent, '专注时钟');
  f.viewer.close();
});

test('a single project can be previewed even when it is outside the current filter', () => {
  const f = fixture({ selected: [] });
  f.viewer.open(projects[1]);
  assert.equal(f.nodes['#viewer-position'].textContent, '1 / 1');
  assert.equal(f.nodes['#viewer-previous'].disabled, true);
  assert.equal(f.nodes['#viewer-next'].disabled, true);
  f.viewer.close();
});

test('screen controls resize the existing document without reloading project state', () => {
  const f = fixture();
  f.nodes['#viewer-canvas'].clientWidth = 360;
  f.viewer.open(projects[0]);
  const frame = f.frame;
  assert.equal(frame.style.width, '1200px');
  assert.equal(frame.style.height, '2000px');
  assert.equal(frame.style.transform, 'scale(0.3)');
  f.devices[1].click();
  assert.equal(f.frame, frame);
  assert.equal(frame.style.width, '360px');
  assert.equal(frame.style.height, '600px');
  assert.equal(f.devices[1].getAttribute('aria-pressed'), 'true');
  assert.equal(f.devices[0].getAttribute('aria-pressed'), 'false');
  f.nodes['#viewer-canvas'].clientWidth = 320;
  f.observer.callback();
  assert.equal(frame.style.width, '320px');
  f.devices[0].click();
  assert.equal(frame.style.width, '1200px');
  f.viewer.close();
  assert.equal(f.observer.target, null);
});

test('phones open with an interactive mobile viewport', () => {
  const f = fixture({ mobile: true });
  f.nodes['#viewer-canvas'].clientWidth = 390;
  f.viewer.open(projects[0]);
  assert.equal(f.nodes['#viewer-canvas'].dataset.device, 'mobile');
  assert.equal(f.frame.style.transform, 'scale(1)');
  f.viewer.close();
});

test('late load and error events from a replaced frame cannot change the active project', () => {
  const f = fixture();
  f.viewer.open(projects[0]);
  const old = f.frame;
  f.nodes['#viewer-next'].click();
  old.dispatchEvent(new Event('load'));
  old.dispatchEvent(new Event('error'));
  assert.equal(f.nodes['#viewer-loading'].hidden, false);
  assert.equal(f.nodes['#viewer-error'].hidden, true);
  assert.equal(f.timers.size, 1);
  f.frame.dispatchEvent(new Event('load'));
  assert.equal(f.nodes['#viewer-loading'].hidden, true);
  assert.equal(f.nodes['#viewer-frame-host'].getAttribute('aria-busy'), 'false');
  assert.equal(f.timers.size, 0);
  f.viewer.close();
});

test('a slow project provides recovery controls and can still finish loading', () => {
  const f = fixture();
  f.viewer.open(projects[0]);
  f.expire();
  assert.equal(f.nodes['#viewer-error'].hidden, false);
  assert.equal(f.frame.hidden, true);
  f.frame.dispatchEvent(new Event('load'));
  assert.equal(f.nodes['#viewer-error'].hidden, true);
  assert.equal(f.frame.hidden, false);
  f.frame.dispatchEvent(new Event('error'));
  const failed = f.frame;
  f.nodes['#viewer-retry'].click();
  assert.notEqual(f.frame, failed);
  assert.equal(failed.isConnected, false);
  assert.equal(f.nodes['#viewer-error'].hidden, true);
  assert.equal(f.nodes['#viewer-loading'].hidden, false);
  f.viewer.close();
});

test('closing unloads the frame, clears timers and restores focus without changing scroll', () => {
  const f = fixture();
  f.viewer.open(projects[0], f.opener);
  const frame = f.frame;
  f.nodes['#viewer-close'].click();
  assert.equal(f.dialog.open, false);
  assert.equal(f.frame, undefined);
  assert.equal(frame.isConnected, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.classNames.has('is-viewing-project'), false);
  assert.equal(f.document.activeElement, f.opener);
  assert.deepEqual(f.opener.focusOptions, { preventScroll: true });
  frame.dispatchEvent(new Event('load'));
  f.viewer.open(projects[1]);
  f.dialog.dispatchEvent(new Event('close'));
  assert.ok(f.frame, 'a queued close event must not unload a reopened dialog');
  f.viewer.close();
});

test('Escape and backdrop clicks close the viewer while clicks inside its bounds do not', () => {
  const f = fixture();
  f.viewer.open(projects[0]);
  f.dialog.dispatchEvent(Object.assign(new Event('click'), { clientX: 200, clientY: 200 }));
  assert.equal(f.dialog.open, true);
  f.dialog.dispatchEvent(Object.assign(new Event('click'), { clientX: 10, clientY: 10 }));
  assert.equal(f.dialog.open, false);
  f.viewer.open(projects[0]);
  const escape = new Event('cancel', { cancelable: true });
  f.dialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.frame, undefined);
});

test('unsafe URLs are rejected and browsers without dialogs retain ordinary link navigation', () => {
  const f = fixture();
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/']) {
    assert.throws(() => f.viewer.open({ ...projects[0], url }));
  }
  assert.equal(f.dialog.open, false);
  f.dialog.showModal = undefined;
  assert.equal(f.viewer.open(projects[0]), false);
  assert.equal(f.frame, undefined);
});
