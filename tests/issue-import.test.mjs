import test from 'node:test';
import assert from 'node:assert/strict';
import { runIssueImport, isContributor } from '../scripts/issue-import.mjs';

const author = { id: 7, login: 'Maker', type: 'User' };
const contributor = { ...author, contributions: 3 };
const html = '<!doctype html>\n<html><head><title>My project</title></head><body><script>window.example = 1;</script><h1>Project</h1></body></html>';
const form = (id = 'new-project') => `### 项目标识\n\n${id}\n\n### 项目名称\n\n新项目\n\n### 项目简介\n\n一个独立网页。\n\n### 分类\n\ntool\n\n### 标签\n\nHTML, CSS\n\n### 网页 HTML\n\n\`\`\`html\n${html}\n\`\`\``;
const original = { id: 'existing', title: '已有项目', description: '保持原样', category: 'design', tags: ['HTML'], date: '2026-11-13', url: 'demos/existing/index.html', preview: null, featured: false };

function apiError(status) { return Object.assign(new Error(`API ${status}`), { status }); }

function harness(options = {}) {
  const snapshot = { number: 12, title: '[作品提交] 新项目', body: form(), user: author, ...options.issue };
  const calls = [];
  const outputs = {};
  const failures = [];
  const messages = [];
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const store = { head: 'head-0', projects: structuredClone(options.projects || [original]), files: new Map(), comments: [], closed: false };
  let issueReads = 0;
  let sequence = 0;
  let conflictPending = !!options.conflict;
  const method = (name, fn) => async params => { calls.push({ name, params }); return { data: await fn(params) }; };
  const rest = {
    repos: {
      listContributors: async () => {},
      get: method('repos.get', () => ({ default_branch: options.branch || 'main' })),
      getContent: method('repos.getContent', params => {
        if (params.path === 'data/projects.json') return { type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(store.projects)).toString('base64') };
        if (options.occupied || store.files.has(params.path)) return { type: 'file' };
        throw apiError(404);
      }),
    },
    issues: {
      get: method('issues.get', () => {
        const current = options.currentIssue?.(++issueReads, snapshot) || snapshot;
        return structuredClone(current);
      }),
      listComments: async () => {},
      createComment: method('issues.createComment', params => {
        const comment = { id: 99, body: params.body, user: { login: 'github-actions[bot]', type: 'Bot' } };
        store.comments.push(comment); return comment;
      }),
      updateComment: method('issues.updateComment', params => { store.comments.find(c => c.id === params.comment_id).body = params.body; return {}; }),
      update: method('issues.update', () => { store.closed = true; return {}; }),
    },
    git: {
      getRef: method('git.getRef', () => ({ object: { sha: store.head } })),
      getCommit: method('git.getCommit', () => ({ tree: { sha: 'base-tree' } })),
      createBlob: method('git.createBlob', params => {
        const sha = `blob-${++sequence}`; blobs.set(sha, Buffer.from(params.content, 'base64').toString('utf8')); return { sha };
      }),
      createTree: method('git.createTree', params => {
        const sha = `tree-${++sequence}`; trees.set(sha, params.tree); return { sha };
      }),
      createCommit: method('git.createCommit', params => {
        const sha = `commit-${++sequence}`; commits.set(sha, params); return { sha };
      }),
      updateRef: method('git.updateRef', params => {
        if (options.protected) throw apiError(403);
        if (conflictPending) {
          conflictPending = false;
          store.head = 'concurrent-head';
          store.projects.push({ ...original, id: 'concurrent', url: 'demos/concurrent/index.html' });
          throw apiError(422);
        }
        const commit = commits.get(params.sha);
        assert.equal(params.force, false);
        assert.equal(commit.parents[0], store.head);
        for (const item of trees.get(commit.tree)) {
          const content = blobs.get(item.sha);
          if (item.path === 'data/projects.json') store.projects = JSON.parse(content);
          else store.files.set(item.path, content);
        }
        store.head = params.sha; return {};
      }),
    },
  };
  const github = {
    rest,
    paginate: async (endpoint, params) => {
      calls.push({ name: 'paginate', params, endpoint });
      if (endpoint === rest.repos.listContributors) {
        if (options.contributorsError) throw apiError(503);
        return options.contributors || [contributor];
      }
      if (options.feedbackError) throw apiError(503);
      return store.comments;
    },
  };
  const core = {
    setOutput: (name, value) => { outputs[name] = value; },
    setFailed: message => failures.push(message),
    info: message => messages.push(message),
    notice: message => messages.push(message),
    warning: message => messages.push(message),
  };
  const context = { repo: { owner: 'owner', repo: 'gallery' }, payload: { issue: snapshot, sender: options.sender || author } };
  return { github, context, core, calls, outputs, failures, store, messages };
}

const mutations = env => env.calls.filter(call => /^git\.(create|update)/.test(call.name));

test('only actual Contributors match: case-insensitive login plus immutable account ID', () => {
  assert.equal(isContributor([contributor], { ...author, login: 'maker' }), true);
  assert.equal(isContributor([{ ...contributor, contributions: 0 }], author), false);
  assert.equal(isContributor([contributor], { ...author, id: 8 }), false);
  assert.equal(isContributor([contributor], { ...author, login: 'Owner' }), false);
  assert.equal(isContributor([contributor], null), false);
});

test('a non-Contributor author cannot add files even if the editor is a Contributor', async () => {
  const env = harness({ issue: { user: { id: 8, login: 'outsider', author_association: 'OWNER' } } });
  assert.equal((await runIssueImport(env)).status, 'rejected');
  assert.equal(env.outputs.publish, 'false');
  assert.equal(mutations(env).length, 0);
  assert.equal(env.store.projects.length, 1);
  assert.equal(env.store.closed, false);
});

test('an outsider editing a Contributor issue is also refused', async () => {
  const env = harness({ sender: { id: 8, login: 'outsider' } });
  assert.equal((await runIssueImport(env)).status, 'rejected');
  assert.equal(mutations(env).length, 0);
});

test('Contributors API failure fails closed rather than granting write access', async () => {
  const env = harness({ contributorsError: true });
  assert.equal((await runIssueImport(env)).status, 'failed');
  assert.equal(mutations(env).length, 0);
  assert.equal(env.failures.length, 1);
  assert.equal(env.outputs.publish, 'false');
});

test('authorized HTML and metadata become exactly two files in one atomic commit', async () => {
  const env = harness({ branch: 'develop' });
  const result = await runIssueImport(env);
  assert.equal(result.status, 'imported');
  assert.equal(env.store.files.get('demos/new-project/index.html'), html);
  assert.equal(env.store.projects.length, 2);
  assert.deepEqual(env.store.projects[0], original);
  assert.deepEqual(env.store.projects[1].submission, { issue: 12, author: 'Maker' });
  const tree = env.calls.find(call => call.name === 'git.createTree').params;
  assert.deepEqual(tree.tree.map(item => item.path), ['demos/new-project/index.html', 'data/projects.json']);
  assert.equal(env.outputs.publish, 'true');
  assert.equal(env.outputs.branch, 'develop');
  assert.equal(env.outputs.commit_sha, env.store.head);
  assert.equal(env.store.closed, true);
  assert.equal(env.failures.length, 0);
  assert.ok(env.calls.some(call => call.name === 'paginate' && call.endpoint === env.github.rest.repos.listContributors));
});

test('retrying an accepted Issue republishes without adding or overwriting a project', async () => {
  const existing = { ...original, submission: { issue: 12, author: 'Maker' } };
  const env = harness({ projects: [existing] });
  assert.equal((await runIssueImport(env)).status, 'existing');
  assert.equal(mutations(env).length, 0);
  assert.deepEqual(env.store.projects, [existing]);
  assert.equal(env.outputs.publish, 'true');
  assert.equal(env.outputs.commit_sha, 'head-0');
});

test('new issues cannot overwrite an existing ID or an unlisted HTML file', async () => {
  for (const options of [{ issue: { body: form('existing') } }, { occupied: true }]) {
    const env = harness(options);
    assert.equal((await runIssueImport(env)).status, 'failed');
    assert.equal(mutations(env).length, 0);
    assert.equal(env.outputs.publish, 'false');
    assert.equal(env.store.projects.length, 1);
  }
});

test('a concurrent branch update is re-read and preserved, with no force push', async () => {
  const env = harness({ conflict: true });
  assert.equal((await runIssueImport(env)).status, 'imported');
  assert.deepEqual(env.store.projects.map(project => project.id), ['existing', 'concurrent', 'new-project']);
  assert.equal(env.calls.filter(call => call.name === 'git.updateRef').length, 2);
  assert.ok(env.calls.filter(call => call.name === 'git.updateRef').every(call => call.params.force === false));
});

test('older Issue events do not publish content edited by a later actor', async () => {
  const env = harness({ currentIssue: (read, snapshot) => ({ ...snapshot, body: form('other-content') }) });
  assert.equal((await runIssueImport(env)).status, 'superseded');
  assert.equal(mutations(env).length, 0);
  assert.equal(env.outputs.publish, 'false');
});

test('editing during import prevents the branch from changing', async () => {
  const env = harness({ currentIssue: (read, snapshot) => read === 1 ? snapshot : { ...snapshot, body: form('edited') } });
  assert.equal((await runIssueImport(env)).status, 'superseded');
  assert.equal(env.calls.filter(call => call.name === 'git.updateRef').length, 0);
  assert.equal(env.store.head, 'head-0');
  assert.equal(env.store.files.size, 0);
});

test('branch protection reports failure without forcing or publishing a commit', async () => {
  const env = harness({ protected: true });
  assert.equal((await runIssueImport(env)).status, 'failed');
  assert.equal(env.outputs.publish, 'false');
  assert.match(env.failures[0], /分支保护/);
  assert.equal(env.store.head, 'head-0');
  assert.equal(env.store.projects.length, 1);
});

test('Issue feedback failure does not prevent an imported project from deploying', async () => {
  const env = harness({ feedbackError: true });
  assert.equal((await runIssueImport(env)).status, 'imported');
  assert.equal(env.outputs.publish, 'true');
  assert.equal(env.store.projects.length, 2);
  assert.equal(env.failures.length, 0);
});
