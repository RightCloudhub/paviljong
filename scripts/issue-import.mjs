import { applySubmission, parseSubmission } from './issue-project.mjs';

const PREFIX = '[作品提交]';
const COMMENT_MARKER = '<!-- paviljong-project-import -->';
const MAX_ATTEMPTS = 5;

export function isContributor(contributors, user) {
  if (!user || typeof user.login !== 'string' || !Number.isSafeInteger(user.id)) return false;
  return contributors.some(contributor => contributor.id === user.id
    && typeof contributor.login === 'string'
    && contributor.login.toLowerCase() === user.login.toLowerCase()
    && contributor.contributions > 0);
}

function sameSubmission(current, snapshot) {
  return current.user?.id === snapshot.user?.id
    && current.title === snapshot.title && current.body === snapshot.body;
}

function readProjectList(content) {
  if (content.type !== 'file' || content.encoding !== 'base64' || typeof content.content !== 'string') {
    throw new Error('data/projects.json 无法读取为普通文件。');
  }
  try {
    const projects = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
    if (!Array.isArray(projects)) throw new Error('Not an array');
    return projects;
  } catch {
    throw new Error('仓库的 data/projects.json 不是有效项目数组，请先修复该文件。');
  }
}

async function checkDestination(github, repo, path, ref) {
  try {
    await github.rest.repos.getContent({ ...repo, path, ref });
  } catch (error) {
    if (error.status === 404) return;
    throw error;
  }
  throw new Error('目标 HTML 文件已存在，不能通过 Issue 覆盖，请选择新的项目标识。');
}

/** Issue content is only API data; no submitted code or shell commands run here. */
export async function runIssueImport({ github, context, core }) {
  const snapshot = context.payload.issue;
  const repo = context.repo;
  core.setOutput('publish', 'false');
  core.setOutput('branch', '');
  core.setOutput('commit_sha', '');
  if (!snapshot || !snapshot.title?.startsWith(PREFIX) || snapshot.pull_request) return { status: 'ignored' };
  const issueNumber = snapshot.number;

  async function latestIssue() {
    return (await github.rest.issues.get({ ...repo, issue_number: issueNumber })).data;
  }

  async function feedback(message, close = false) {
    try {
      const body = `${COMMENT_MARKER}\n${message}`;
      const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issueNumber, per_page: 100 });
      const existing = comments.find(comment => comment.user?.login === 'github-actions[bot]'
        && comment.user?.type === 'Bot' && comment.body?.startsWith(COMMENT_MARKER));
      if (existing) await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
      else await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
      if (close) await github.rest.issues.update({ ...repo, issue_number: issueNumber, state: 'closed', state_reason: 'completed' });
    } catch {
      // A successful commit must still deploy if posting feedback is unavailable.
      core.warning('无法更新 Issue 的处理结果；请查看本次 Actions 运行记录。');
    }
  }

  function publishOutputs(branch, sha) {
    core.setOutput('publish', 'true');
    core.setOutput('branch', branch);
    core.setOutput('commit_sha', sha);
  }

  try {
    const issue = await latestIssue();
    if (!sameSubmission(issue, snapshot)) {
      core.info('Issue 内容已更新，跳过旧事件，等待对应的新提交或编辑事件。');
      return { status: 'superseded' };
    }
    const contributors = await github.paginate(github.rest.repos.listContributors, { ...repo, per_page: 100 });
    if (!isContributor(contributors, issue.user) || !isContributor(contributors, context.payload.sender)) {
      await feedback('未收录：Issue 作者和本次提交或编辑者都必须在本仓库 GitHub Contributors 名单中，且有实际贡献记录。拥有仓库或协作者权限不会跳过此校验。新贡献可能需要等待 GitHub 更新名单后，再编辑 Issue 重试。');
      core.notice('Contributor 校验未通过，未修改仓库文件。');
      return { status: 'rejected' };
    }

    const submission = parseSubmission(issue.body);
    const repository = (await github.rest.repos.get(repo)).data;
    const branch = repository.default_branch;
    if (typeof branch !== 'string' || !branch) throw new Error('无法确定仓库默认分支。');
    const provenance = { issueNumber, author: issue.user.login, date: new Date().toISOString().slice(0, 10) };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const head = (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data.object.sha;
      const content = (await github.rest.repos.getContent({ ...repo, path: 'data/projects.json', ref: head })).data;
      const projects = readProjectList(content);
      const existing = projects.find(project => project.submission?.issue === issueNumber);
      if (existing) {
        if (existing.submission.author?.toLowerCase() !== issue.user.login.toLowerCase()) {
          throw new Error('已有项目的 Issue 来源账号不一致，请由维护者检查数据。');
        }
        publishOutputs(branch, head);
        await feedback(`此 Issue 已收录为 \`${existing.id}\`，本次没有重复新增或覆盖文件。将重新发布当前作品集；修改已收录作品请提交 Pull Request。`, true);
        return { status: 'existing', branch, sha: head };
      }

      const update = applySubmission(projects, submission, provenance);
      await checkDestination(github, repo, update.htmlPath, head);
      const parent = (await github.rest.git.getCommit({ ...repo, commit_sha: head })).data;
      const htmlBlob = (await github.rest.git.createBlob({ ...repo, encoding: 'base64', content: Buffer.from(update.html, 'utf8').toString('base64') })).data;
      const dataBlob = (await github.rest.git.createBlob({ ...repo, encoding: 'base64', content: Buffer.from(`${JSON.stringify(update.projects, null, 2)}\n`, 'utf8').toString('base64') })).data;
      const tree = (await github.rest.git.createTree({
        ...repo,
        base_tree: parent.tree.sha,
        tree: [
          { path: update.htmlPath, mode: '100644', type: 'blob', sha: htmlBlob.sha },
          { path: 'data/projects.json', mode: '100644', type: 'blob', sha: dataBlob.sha },
        ],
      })).data;
      const commit = (await github.rest.git.createCommit({
        ...repo,
        message: `feat: add ${submission.id} from issue #${issueNumber}\n\nSubmitted-by: @${issue.user.login}`,
        tree: tree.sha,
        parents: [head],
      })).data;

      if (!sameSubmission(await latestIssue(), snapshot)) {
        core.info('Issue 在处理期间更新，未更新分支，等待新的编辑事件。');
        return { status: 'superseded' };
      }
      try {
        await github.rest.git.updateRef({ ...repo, ref: `heads/${branch}`, sha: commit.sha, force: false });
      } catch (error) {
        if ([409, 422].includes(error.status) && attempt < MAX_ATTEMPTS - 1) {
          core.info('默认分支发生并发更新，重新读取项目列表后重试。');
          continue;
        }
        if ([403, 409, 422].includes(error.status)) {
          throw new Error('无法更新默认分支。请检查分支保护、仓库 Actions 写入权限或并发提交；本流程不会强制推送或绕过保护。');
        }
        throw error;
      }

      publishOutputs(branch, commit.sha);
      const server = context.serverUrl || 'https://github.com';
      const commitURL = `${server}/${repo.owner}/${repo.repo}/commit/${commit.sha}`;
      await feedback(`已收录 \`${submission.id}\`：新增 \`${update.htmlPath}\` 并更新作品集数据。[查看提交](${commitURL})。\n\nPages 部署将由本次工作流继续执行；发布结果请查看 Actions 的 Publish updated portfolio 任务。`, true);
      core.info(`已原子收录项目 ${submission.id}，提交 ${commit.sha}。`);
      return { status: 'imported', branch, sha: commit.sha };
    }
    throw new Error('并发更新重试次数已用完，请重新运行本次 Action。');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '处理失败，请查看 Actions 运行记录。';
    core.setFailed(reason);
    await feedback(`未收录：${reason}\n\n修正表单后编辑 Issue 会重新校验；临时 API 或权限问题修复后可重新运行 Action。`);
    return { status: 'failed' };
  }
}
