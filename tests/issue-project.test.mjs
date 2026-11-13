import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmission, createProject, applySubmission } from '../scripts/issue-project.mjs';

const HTML = '<!doctype html>\n<html lang="zh-CN"><head><title>测试网页</title></head><body><h1>作品</h1></body></html>';
const provenance = { issueNumber: 42, author: 'contributor', date: '2026-11-13' };
function form({ id = 'new-project', title = '测试作品', description = '一个独立的 HTML 网页', category = 'design', tags = 'HTML, CSS', html = HTML, fence = '```' } = {}) {
  return `### 项目标识\n\n${id}\n\n### 项目名称\n\n${title}\n\n### 项目简介\n\n${description}\n\n### 分类\n\n${category}\n\n### 标签\n\n${tags}\n\n### 网页 HTML\n\n${fence}html\n${html}\n${fence}`;
}

test('the issue form produces a local project with trusted provenance and unchanged source', () => {
  const submission = parseSubmission(form());
  assert.deepEqual(submission, { id: 'new-project', title: '测试作品', description: '一个独立的 HTML 网页', category: 'design', tags: ['HTML', 'CSS'], html: HTML });
  assert.deepEqual(createProject(submission, provenance), {
    id: 'new-project', title: '测试作品', description: '一个独立的 HTML 网页', category: 'design', tags: ['HTML', 'CSS'],
    date: '2026-11-13', url: 'demos/new-project/index.html', preview: null, featured: false,
    submission: { issue: 42, author: 'contributor' },
  });
});

test('path traversal, uppercase names and repeated or edge hyphens cannot become filenames', () => {
  for (const id of ['../secrets', '/tmp/file', 'x/../../data', 'UPPER', 'a--b', '-a', 'a-', 'a.b', 'a_b', '%2e%2e', 'a'.repeat(49)]) {
    assert.throws(() => parseSubmission(form({ id })), /项目标识/);
  }
  assert.equal(parseSubmission(form({ id: 'project-123' })).id, 'project-123');
});

test('HTML headings and literal code fences stay source text rather than metadata', () => {
  const html = '<!DOCTYPE HTML>\n<HTML><HEAD><TITLE>Source</TITLE></HEAD><BODY><script>\nconst example = `\n### 项目标识\n\n../../unsafe\n\n```\n`;\n</script><p>Done</p></BODY></HTML>';
  assert.equal(parseSubmission(form({ html })).html, html);
  assert.equal(parseSubmission(form({ html, fence: '````' })).html, html);
  assert.equal(parseSubmission(form({ html })).id, 'new-project');
});

test('missing, repeated, renamed, reordered and appended fields are rejected', () => {
  const body = form();
  const malformed = [
    body.replace('### 项目标识', '### 任意字段'),
    body.replace('### 标签\n\nHTML, CSS\n\n', ''),
    body.replace('### 项目简介', '### 项目名称'),
    body.replace('### 分类', '### 额外字段\n\nvalue\n\n### 分类'),
    `preamble\n${body}`,
    `${body}\n\n### 任意字段\n\nvalue`,
    body.replace('```html', '```javascript'),
    body.replace('### 项目标识', '### 网页 HTML'),
  ];
  for (const candidate of malformed) assert.throws(() => parseSubmission(candidate));
  assert.throws(() => parseSubmission(''), /正文不能为空/);
});

test('classification, metadata and tags obey useful bounds and support empty form tags', () => {
  for (const category of ['__proto__', 'constructor', 'other', 'Design']) assert.throws(() => parseSubmission(form({ category })), /分类/);
  assert.throws(() => parseSubmission(form({ title: 'a'.repeat(81) })), /项目名称/);
  assert.throws(() => parseSubmission(form({ title: '_No response_' })), /项目名称/);
  assert.throws(() => parseSubmission(form({ title: 'line\nline' })), /项目名称/);
  assert.throws(() => parseSubmission(form({ description: '字'.repeat(241) })), /项目简介/);
  assert.throws(() => parseSubmission(form({ tags: '1,2,3,4,5,6,7' })), /最多 6/);
  assert.throws(() => parseSubmission(form({ tags: 'a'.repeat(25) })), /每个标签/);
  assert.throws(() => parseSubmission(form({ tags: 'HTML,,CSS' })), /每个标签/);
  assert.deepEqual(parseSubmission(form({ tags: '_No response_' })).tags, []);
  assert.deepEqual(parseSubmission(form({ tags: '' })).tags, []);
  assert.deepEqual(parseSubmission(form({ tags: 'HTML，CSS, HTML' })).tags, ['HTML', 'CSS']);
  assert.equal(parseSubmission(form({ title: '😀'.repeat(80) })).title, '😀'.repeat(80));
});

test('UTF-8 byte limits are enforced rather than JavaScript string length', () => {
  const overHTML = HTML.replace('<h1>作品</h1>', `<p>${'字'.repeat(19000)}</p>`);
  assert.throws(() => parseSubmission(form({ html: overHTML })), /HTML 最多 55 KiB/);
  assert.throws(() => parseSubmission('字'.repeat(22000)), /正文最多 64 KiB/);
});

test('only complete documents pass while inline JavaScript remains inert stored text', () => {
  for (const html of ['<h1>fragment</h1>', HTML.replace('<!doctype html>', ''), HTML.replace('</body>', ''), HTML.replace('<title>测试网页</title>', '<title></title>'), HTML.replace('<title>测试网页</title>', '<title> \n </title>'), HTML.replace('</html>', '')]) {
    assert.throws(() => parseSubmission(form({ html })), /完整 HTML 文档/);
  }
  const source = HTML.replace('<h1>作品</h1>', '<script>globalThis.issueParserExecuted = true;</script>');
  delete globalThis.issueParserExecuted;
  assert.equal(parseSubmission(form({ html: source })).html, source);
  assert.equal(globalThis.issueParserExecuted, undefined);
});

test('legal document-level comments around the doctype and root preserve the complete HTML', () => {
  const source = `<!-- source header -->\n${HTML.replace('<!doctype html>', '<!doctype html>\n<!-- project header -->')}\n<!-- end note -->`;
  assert.equal(parseSubmission(form({ html: source })).html, source);
});

test('many boundary comments and an invalid doctype reject without regex backtracking', () => {
  const source = '<!--x-->'.repeat(6000) + HTML.replace('<!doctype html>', '<!doctype invalid>');
  const started = performance.now();
  assert.throws(() => parseSubmission(form({ html: source })), /完整 HTML 文档/);
  assert.ok(performance.now() - started < 1000, 'malformed document should be rejected promptly');
});

test('thousands of unmatched head/title tags reject in linear time', () => {
  const html = '<!doctype html><html>' + '<head><title>x</title>'.repeat(2500) + '<body></body></html>';
  const submission = { id: 'bounded-scan', title: '测试', description: '测试', category: 'design', tags: [], html };
  const started = performance.now();
  assert.throws(() => createProject(submission, provenance), /完整 HTML 文档/);
  assert.ok(performance.now() - started < 1000, 'unmatched repeated tags should be rejected promptly');
});

test('document boundaries and head/body order require correctly paired structural tags', () => {
  const malformed = [
    '<!doctype html><html><body></body><head><title>x</title></head></html>',
    '<!doctype html><html><head><title>x</title><body></body></html>',
    '<!doctype html><html><head><title>x</title></head><body></body><body></body></html>',
    '<!doctype html><html><head></head><body><title>body title</title></body></html>',
    '<!doctype html><html><head><title>x</title></head><body></html></body>',
    '<!doctype html><html/><head><title>x</title></head><body></body></html>',
  ];
  for (const html of malformed) assert.throws(() => parseSubmission(form({ html })), /完整 HTML 文档/);
});

test('fake tags in comments, quoted attributes and raw script/style text cannot change document structure', () => {
  const html = '<!doctype html><html data-example="İ > <head>"><head><!-- <body> --><title>真实标题</title><style>p::after{content:"<head><title>fake</title>"}</style></head><body><script>const source = "<head><title>fake</title><body>";</script><svg><title>图形标题</title></svg><textarea><head></body></textarea><p>保留</p></body></html>';
  assert.equal(parseSubmission(form({ html })).html, html);
  const missingTitle = '<!doctype html><html><head><script>const fake = "<title>fake</title>";</script></head><body></body></html>';
  assert.throws(() => parseSubmission(form({ html: missingTitle })), /完整 HTML 文档/);
  const brokenAttribute = HTML.replace('<h1>作品</h1>', '<span title="' + '<span title="'.repeat(2500));
  assert.throws(() => parseSubmission(form({ html: brokenAttribute })), /完整 HTML 文档/);
});

test('CRLF document source and intentional whitespace survive the outer form wrapper', () => {
  const html = ` \r\n${HTML.replaceAll('\n', '\r\n')}\r\n `;
  assert.equal(parseSubmission(form({ html })).html, html);
  const crlf = form({ html: HTML.replaceAll('\n', '\r\n') }).replaceAll(/(?<!\r)\n/g, '\r\n');
  assert.equal(parseSubmission(crlf).html, HTML.replaceAll('\n', '\r\n'));
});

test('adding a project returns a new validated array without altering existing content', () => {
  const existing = { id: 'existing', title: '已有项目', description: '保留原有数据', category: 'tool', tags: [], date: '2025-01-01', url: 'demos/existing/index.html', preview: null, featured: true };
  const projects = [existing];
  const snapshot = structuredClone(projects);
  const result = applySubmission(projects, parseSubmission(form()), provenance);
  assert.notEqual(result.projects, projects);
  assert.deepEqual(projects, snapshot);
  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.projects[0], snapshot[0]);
  assert.equal(result.htmlPath, 'demos/new-project/index.html');
  assert.equal(result.html, HTML);
});

test('duplicate IDs and invalid trusted provenance cannot update the gallery', () => {
  const submission = parseSubmission(form());
  const existing = createProject(submission, provenance);
  assert.throws(() => applySubmission([existing], submission, provenance), /标识已存在/);
  assert.throws(() => applySubmission([{ ...existing, id: 'NEW-PROJECT' }], submission, provenance), /标识已存在/);
  assert.throws(() => createProject(submission, { ...provenance, issueNumber: 0 }), /编号无效/);
  assert.throws(() => createProject(submission, { ...provenance, issueNumber: 1.5 }), /编号无效/);
  assert.throws(() => createProject(submission, { ...provenance, author: 'bad\nlogin' }), /提交者账号/);
  assert.throws(() => createProject(submission, { ...provenance, date: '2026-02-30' }), /日期无效/);
  assert.throws(() => applySubmission({}, submission, provenance), /项目数组/);
});
