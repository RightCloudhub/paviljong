import { CATEGORY_LABELS, normalizeProjects } from '../assets/gallery.mjs';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HTML_BYTES = 55 * 1024;
const FIELDS = ['项目标识', '项目名称', '项目简介', '分类', '标签'];
const VALIDATION_BASE = 'https://project-validation.invalid/gallery/';

function textValue(value, label, limit, { optional = false, multiline = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label}需要填写文字。`);
  const text = value.trim();
  if (optional && (!text || text === '_No response_')) return '';
  if (!text || text === '_No response_') throw new Error(`${label}不能为空。`);
  if ([...text].length > limit) throw new Error(`${label}最多 ${limit} 个字符。`);
  if ((!multiline && /[\r\n]/.test(text)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error(`${label}包含无效的换行或控制字符。`);
  }
  return text;
}

function stripLeadingComments(text) {
  let remaining = text;
  while (remaining.startsWith('<!--')) {
    const end = remaining.indexOf('-->', 4);
    if (end < 0) return '';
    remaining = remaining.slice(end + 3).trimStart();
  }
  return remaining;
}

function documentRoot(html) {
  let remaining = stripLeadingComments(html.trim());
  const doctype = /^<!doctype\s+html\s*>/i.exec(remaining);
  if (!doctype) return '';
  remaining = stripLeadingComments(remaining.slice(doctype[0].length).trimStart());
  // Scan comments at the document boundary instead of backtracking through comment runs.
  while (remaining.endsWith('-->')) {
    const start = remaining.lastIndexOf('<!--');
    if (start < 0 || remaining.indexOf('-->', start + 4) !== remaining.length - 3) return '';
    remaining = remaining.slice(0, start).trimEnd();
  }
  return remaining;
}

function completeDocument(document) {
  if (!document) return false;
  // ASCII folding keeps source offsets intact, including Unicode characters such as İ.
  const folded = document.replace(/[A-Z]/g, letter => letter.toLowerCase());
  const tagStart = /<(\/?)([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/iy;
  const rawTextTags = new Set(['script', 'style', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);
  let cursor = 0;
  let state = 'before-html';
  let hasTitle = false;

  function readTag(start) {
    tagStart.lastIndex = start;
    const match = tagStart.exec(document);
    if (!match) return null;
    let quote = '';
    for (let index = tagStart.lastIndex; index < document.length; index++) {
      const character = document[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return { name: match[2].toLowerCase(), closing: Boolean(match[1]), selfClosing: document.slice(start, index).trimEnd().endsWith('/'), start, end: index + 1 };
      }
    }
    return { invalid: true };
  }

  function rawTextClose(name, start) {
    const needle = `</${name}`;
    let position = folded.indexOf(needle, start);
    while (position >= 0) {
      const following = folded[position + needle.length];
      if (following === '>' || /[\t\n\f\r ]/.test(following || '')) return readTag(position);
      position = folded.indexOf(needle, position + needle.length);
    }
    return null;
  }

  while (cursor < document.length) {
    if (document[cursor] !== '<') {
      const next = document.indexOf('<', cursor);
      const end = next < 0 ? document.length : next;
      if (state !== 'head' && state !== 'body' && document.slice(cursor, end).trim()) return false;
      cursor = end;
      continue;
    }
    if (document.startsWith('<!--', cursor)) {
      const end = document.indexOf('-->', cursor + 4);
      if (end < 0) return false;
      cursor = end + 3;
      continue;
    }
    if (state === 'body' && document.startsWith('<![CDATA[', cursor)) {
      const end = document.indexOf(']]>', cursor + 9);
      if (end < 0) return false;
      cursor = end + 3;
      continue;
    }
    const token = readTag(cursor);
    if (token?.invalid) return false;
    if (!token) {
      if (state !== 'head' && state !== 'body') return false;
      // A literal less-than sign in normal content is text, not an HTML tag.
      cursor++;
      continue;
    }
    const { name, closing, selfClosing } = token;
    if (name === 'html') {
      if (selfClosing) return false;
      if (!closing && state === 'before-html') state = 'before-head';
      else if (closing && state === 'after-body') state = 'closed';
      else return false;
    } else if (name === 'head') {
      if (selfClosing) return false;
      if (!closing && state === 'before-head') state = 'head';
      else if (closing && state === 'head' && hasTitle) state = 'after-head';
      else return false;
    } else if (name === 'body') {
      if (selfClosing) return false;
      if (!closing && state === 'after-head') state = 'body';
      else if (closing && state === 'body') state = 'after-body';
      else return false;
    } else if (name === 'title' || rawTextTags.has(name)) {
      if (state !== 'head' && state !== 'body') return false;
      if (closing || (name === 'title' && selfClosing)) return false;
      if (name === 'title' && state === 'head' && hasTitle) return false;
      const end = rawTextClose(name, token.end);
      if (!end || end.invalid || end.selfClosing) return false;
      if (name === 'title' && state === 'head') {
        if (!document.slice(token.end, end.start).trim()) return false;
        hasTitle = true;
      }
      cursor = end.end;
      continue;
    } else if (state !== 'head' && state !== 'body') {
      return false;
    }
    cursor = token.end;
  }
  return state === 'closed' && hasTitle;
}

function validateHTML(html) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('网页 HTML 不能为空。');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('网页 HTML 最多 55 KiB，请缩减代码。');
  if (html.includes('\u0000')) throw new Error('网页 HTML 不能包含空字符。');
  if (!completeDocument(documentRoot(html))) {
    throw new Error('请提交完整 HTML 文档，包含 <!doctype html>、html、head、非空 title 和 body。');
  }
  // HTML is stored as text. Contributor scripts are never evaluated by this helper.
  return html;
}

function validateSubmission(submission) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw new Error('提交内容格式有误。');
  const id = textValue(submission.id, '项目标识', 48);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('项目标识只能使用小写字母、数字和单个连字符。');
  const title = textValue(submission.title, '项目名称', 80);
  const description = textValue(submission.description, '项目简介', 240, { multiline: true });
  const category = textValue(submission.category, '分类', 24);
  if (!Object.hasOwn(CATEGORY_LABELS, category)) throw new Error('分类需要是 design、interaction 或 tool。');
  if (!Array.isArray(submission.tags) || submission.tags.length > 6) throw new Error('标签需要是数组，最多 6 个。');
  const tags = submission.tags.map(tag => textValue(tag, '每个标签', 24));
  const html = validateHTML(submission.html);
  return { id, title, description, category, tags: [...new Set(tags)], html };
}

/** Parse the exact issue form; HTML is the last field and may itself contain headings or fences. */
export function parseSubmission(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('Issue 正文不能为空。');
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('Issue 正文最多 64 KiB。');
  const htmlHeading = /^### 网页 HTML[ \t]*\r?$/m.exec(body);
  if (!htmlHeading) throw new Error('缺少“网页 HTML”字段，请使用添加作品模板。');
  const prefix = body.slice(0, htmlHeading.index);
  const headings = [...prefix.matchAll(/^### ([^\r\n]+)\r?$/gm)];
  if (headings.length !== FIELDS.length || prefix.slice(0, headings[0]?.index ?? prefix.length).trim()) {
    throw new Error('Issue 字段缺失、重复或包含额外内容，请使用添加作品模板。');
  }
  const fields = {};
  for (let index = 0; index < FIELDS.length; index++) {
    const heading = headings[index];
    if (heading[1].trim() !== FIELDS[index]) throw new Error('Issue 字段顺序或名称有误，请使用添加作品模板。');
    const start = heading.index + heading[0].length;
    fields[FIELDS[index]] = prefix.slice(start, headings[index + 1]?.index ?? prefix.length).trim();
  }
  const fenced = body.slice(htmlHeading.index + htmlHeading[0].length).trim();
  const opening = /^(`{3,})html[ \t]*\r?\n/i.exec(fenced);
  if (!opening || !fenced.endsWith(`\n${opening[1]}`)) {
    throw new Error('网页 HTML 需要放在完整的 html 代码块中，且必须是最后一个字段。');
  }
  // Use only the outer fence. A literal ``` or ### inside a script remains unchanged.
  let html = fenced.slice(opening[0].length, -(opening[1].length + 1));
  if (html.endsWith('\r')) html = html.slice(0, -1);
  const tagsText = textValue(fields['标签'], '标签', 160, { optional: true });
  const tags = tagsText ? tagsText.split(/[,，]/).map(tag => tag.trim()) : [];
  return validateSubmission({
    id: fields['项目标识'], title: fields['项目名称'], description: fields['项目简介'],
    category: fields['分类'], tags, html,
  });
}

/** Build the only metadata an issue may add; addresses and provenance are server-controlled. */
export function createProject(submission, { issueNumber, author, date } = {}) {
  const valid = validateSubmission(submission);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Issue 编号无效。');
  const login = textValue(author, '提交者账号', 100);
  const project = {
    id: valid.id, title: valid.title, description: valid.description, category: valid.category,
    tags: valid.tags, date, url: `demos/${valid.id}/index.html`, preview: null, featured: false,
    submission: { issue: issueNumber, author: login },
  };
  normalizeProjects([project], VALIDATION_BASE);
  return project;
}

/** Return a fresh list; existing projects and source objects are never overwritten or mutated. */
export function applySubmission(projects, submission, provenance) {
  normalizeProjects(projects, VALIDATION_BASE);
  const valid = validateSubmission(submission);
  if (projects.some(project => project.id.toLowerCase() === valid.id)) throw new Error('项目标识已存在，请选择新的标识。');
  const project = createProject(valid, provenance);
  const result = [...projects, project];
  normalizeProjects(result, VALIDATION_BASE);
  return { projects: result, project, htmlPath: project.url, html: valid.html };
}
