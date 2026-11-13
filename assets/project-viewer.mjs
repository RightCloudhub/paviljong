import { safeWebURL } from './gallery.mjs';

/** A single interactive project frame; thumbnails remain separate and read-only. */
export function createProjectViewer(dialog, { getProjects }) {
  const document = dialog.ownerDocument;
  const window = document.defaultView;
  const title = dialog.querySelector('#viewer-title');
  const description = dialog.querySelector('#viewer-description');
  const canvas = dialog.querySelector('#viewer-canvas');
  const host = dialog.querySelector('#viewer-frame-host');
  const loading = dialog.querySelector('#viewer-loading');
  const error = dialog.querySelector('#viewer-error');
  const errorMessage = dialog.querySelector('#viewer-error-message');
  const external = dialog.querySelector('#viewer-external');
  const previous = dialog.querySelector('#viewer-previous');
  const next = dialog.querySelector('#viewer-next');
  const position = dialog.querySelector('#viewer-position');
  const closeButton = dialog.querySelector('#viewer-close');
  const devices = [...dialog.querySelectorAll('[data-viewer-device]')];
  let projects = [];
  let index = -1;
  let frame = null;
  let timer = null;
  let opener = null;

  function clearTimer() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  function sizeFrame() {
    if (!frame || !canvas.clientWidth || !canvas.clientHeight) return;
    const scale = canvas.dataset.device === 'desktop' ? Math.min(1, canvas.clientWidth / 1200) : 1;
    frame.style.width = `${canvas.clientWidth / scale}px`;
    frame.style.height = `${canvas.clientHeight / scale}px`;
    frame.style.transform = `scale(${scale})`;
  }

  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(sizeFrame) : null;
  if (!observer) window.addEventListener('resize', sizeFrame);

  function setDevice(device) {
    canvas.dataset.device = device;
    for (const button of devices) button.setAttribute('aria-pressed', String(button.dataset.viewerDevice === device));
    sizeFrame();
  }

  function showError(message) {
    clearTimer();
    host.setAttribute('aria-busy', 'false');
    loading.hidden = true;
    error.hidden = false;
    errorMessage.textContent = message;
    if (frame) frame.hidden = true;
  }

  function mount(project) {
    const url = safeWebURL(project.url, document.baseURI);
    clearTimer();
    title.textContent = project.title;
    description.textContent = project.description;
    external.href = url;
    external.setAttribute('aria-label', `在新标签页打开项目：${project.title}`);
    position.textContent = `${index + 1} / ${projects.length}`;
    position.setAttribute('aria-label', `第 ${index + 1} 个项目，共 ${projects.length} 个`);
    previous.disabled = index <= 0;
    next.disabled = index >= projects.length - 1;
    loading.hidden = false;
    error.hidden = true;
    host.setAttribute('aria-busy', 'true');

    const current = document.createElement('iframe');
    current.title = `${project.title} · 完整项目`;
    // Imported HTML can run scripts without accessing the gallery's origin.
    current.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
    current.setAttribute('allow', 'clipboard-write');
    current.referrerPolicy = 'no-referrer';
    current.addEventListener('load', () => {
      if (frame !== current) return;
      clearTimer();
      current.hidden = false;
      host.setAttribute('aria-busy', 'false');
      loading.hidden = true;
      error.hidden = true;
    });
    current.addEventListener('error', () => {
      if (frame === current) showError('暂时无法显示这个项目。可以重试，或在新标签页打开。');
    });
    // Use the full URL: preview=1 belongs only to the non-interactive thumbnails.
    current.src = url;
    frame = current;
    host.replaceChildren(current);
    sizeFrame();
    timer = window.setTimeout(() => {
      if (frame === current) showError('项目加载时间较长。可以重试，或在新标签页打开。');
    }, 15000);
  }

  function open(project, trigger = document.activeElement) {
    if (typeof dialog.showModal !== 'function') return false;
    safeWebURL(project.url, document.baseURI);
    const selected = getProjects();
    projects = selected.some(item => item.id === project.id) ? [...selected] : [project];
    index = projects.findIndex(item => item.id === project.id);
    if (!dialog.open) {
      opener = trigger;
      setDevice(window.matchMedia('(max-width: 640px)').matches ? 'mobile' : 'desktop');
      dialog.showModal();
      document.documentElement.classList.add('is-viewing-project');
      observer?.observe(canvas);
    }
    mount(projects[index]);
    closeButton.focus({ preventScroll: true });
    return true;
  }

  function dispose() {
    clearTimer();
    frame = null;
    host.replaceChildren();
    host.setAttribute('aria-busy', 'false');
    observer?.disconnect();
    document.documentElement.classList.remove('is-viewing-project');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
    projects = [];
    index = -1;
  }

  function close() {
    if (dialog.open) dialog.close();
    dispose();
  }

  function step(direction) {
    const target = index + direction;
    if (!dialog.open || target < 0 || target >= projects.length) return;
    index = target;
    mount(projects[index]);
    // A navigation button may become disabled at the end of the list.
    if (document.activeElement === previous && previous.disabled) next.focus({ preventScroll: true });
    if (document.activeElement === next && next.disabled) previous.focus({ preventScroll: true });
  }

  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  closeButton.addEventListener('click', close);
  dialog.querySelector('#viewer-retry').addEventListener('click', () => {
    if (dialog.open && projects[index]) mount(projects[index]);
  });
  for (const button of devices) button.addEventListener('click', () => setDevice(button.dataset.viewerDevice));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) dispose(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  return { open, close };
}
