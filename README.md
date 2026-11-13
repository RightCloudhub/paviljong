# Paviljong · 网页作品集

一个用于展示个人 HTML 网页项目的静态作品集。采用极简卡片网格，项目数据与页面样式分开维护，不需要框架、后端或构建步骤。卡片默认展示项目本身的网页预览，也可换成静态截图。点击作品即可在当前页面展开并操作完整项目，展示交互参考 [oooo.so](https://oooo.so/)。自带 6 个可以实际打开和操作的起始项目，可直接替换为自己的作品。

## 本地预览

在项目目录运行：

```bash
python3 -m http.server 8000
```

浏览器打开 <http://localhost:8000>。项目列表通过 `fetch` 加载 JSON，因此请使用本地 HTTP 服务预览，直接双击 `index.html` 的 `file://` 方式无法正常加载列表。

## 部署到 GitHub Pages

1. 在 GitHub 创建自己的仓库，并将本项目文件推送到 `main` 或 `master` 分支。
2. 打开仓库的 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
3. 打开仓库的 **Actions** 页面，运行 **Deploy static site to GitHub Pages**；之后每次推送到上述分支都会自动部署。
4. 工作流成功后，在 **Settings → Pages** 或部署任务中打开站点链接。

如果仓库已经初始化，可以使用以下命令；把仓库地址替换成自己的地址：

```bash
git add .
git commit -m "Build personal HTML project gallery"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

已有 `origin` 时跳过 `git remote add`，或用 `git remote set-url origin` 修改地址。如果目录还不是 Git 仓库，请先在自己的可写项目目录初始化仓库。

普通项目仓库的网址为 `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`；用户主页仓库 `YOUR_USERNAME.github.io` 则部署在域名根目录。本站及内置项目均使用相对路径，两种形式都适用。部署工作流只上传网站所需的页面、资源、项目数据和示例目录，文档和本地验证输出不会进入部署产物。

## 添加自己的 HTML 项目

1. 在 `demos/` 下创建项目目录，例如 `demos/my-project/`，放入 `index.html` 及其 CSS、JS、图片等资源。
2. 在 `data/projects.json` 的数组中添加一条记录。将 `preview` 设为 `null`，卡片会直接展示真实项目页面，无需准备截图：

```json
{
  "id": "my-project",
  "title": "我的网页项目",
  "description": "一句话描述项目的内容。",
  "category": "design",
  "tags": ["HTML", "CSS"],
  "date": "2026-11-13",
  "url": "demos/my-project/index.html",
  "preview": null,
  "featured": false
}
```

| 字段 | 用途 |
| --- | --- |
| `id` | 唯一标识，建议与项目目录同名 |
| `title` | 卡片上的项目名称 |
| `description` | 项目的简短说明，也用于搜索 |
| `category` | `design`（网页设计）、`interaction`（交互实验）或 `tool`（小工具） |
| `tags` | 技术或主题标签数组 |
| `date` | 项目日期，使用 `YYYY-MM-DD` 格式 |
| `url` | 项目入口，相对于站点根目录的路径 |
| `preview` | `null` 或空字符串使用网页预览；也可填写相对于站点根目录的本地截图路径 |
| `featured` | 布尔值；日期相同时优先显示精选项目 |

路径请写成 `demos/my-project/index.html`，避免以 `/` 开头，以免在 GitHub Pages 项目仓库的子路径下失效。项目内部资源同样使用相对路径。文件和目录名称建议使用英文小写和连字符，避免大小写差异造成线上 404。

如果只想添加一个 HTML 文件，也可以直接放入 `demos/`，例如 `demos/my-project.html`，再将记录的 `url` 改为该路径。

### 选择预览方式

卡片缩略预览使用懒加载 iframe，将项目的 1200 × 750 画布等比例缩小到卡片中。缩略预览地址会附带 `preview=1` 参数；自己的项目可读取该参数，隐藏返回按钮或关闭持续动画。iframe 使用 `sandbox="allow-scripts"`，可以运行页面脚本，独立于主页。

点击卡片会在当前页面展开可操作的完整项目，使用项目原始地址，不额外附带 `preview=1`。即使卡片配置的是静态截图，展开后仍会加载真实网页。预览窗口支持：

- 电脑视图与手机视图切换，切换尺寸时保留当前项目状态；手机默认使用手机视图。
- 按当前筛选和排序结果切换上一个、下一个项目。
- 点击关闭按钮、窗口外的遮罩或按 `Esc` 返回列表，保留搜索、筛选和浏览位置。
- 在新标签页打开完整项目；也可直接用 `Ctrl` / `Cmd` + 点击卡片。

完整项目 iframe 允许脚本、表单、下载和新窗口，但仍保留沙箱隔离，不授予同源访问权限。切换作品或关闭窗口时会移除该 iframe，停止其中的动画和计时。外部网站若通过 CSP 或 `X-Frame-Options` 禁止嵌入，请使用窗口中的「新标签页打开」。

如果项目在预览中需要账号登录、同源权限或其他 iframe 不支持的能力，可以使用静态截图。将图片放入 `assets/previews/`，再把 `preview` 改为 `"assets/previews/my-project.webp"`。建议使用约 1200 × 750 像素的 WebP 图片，也可以使用本地 PNG、JPEG 或 SVG。较多项目或复杂动画也推荐使用静态缩略图，减少同时运行的页面数量。

## 内置起始项目

| 目录 | 内容 | 类别 |
| --- | --- | --- |
| `demos/studio/` | 工作室展示页 | 网页设计 |
| `demos/reading/` | 阅读与杂志页面 | 网页设计 |
| `demos/orbit/` | 轨道粒子交互 | 交互实验 |
| `demos/kinetic/` | 可调文字排版实验 | 交互实验 |
| `demos/palette/` | 配色生成与颜色复制 | 小工具 |
| `demos/focus/` | 专注与休息计时器 | 小工具 |

这些页面是随项目提供的演示作品，默认使用真实网页预览。展示自己的项目时，可删除对应数据记录和文件，或直接替换页面，并按需设置截图。

作品集也已收录目录中提供的 `demos/Pelicans-fable-5.2-max/index.html`（鹈鹕骑自行车）。原页面保持原样，卡片使用从该页面初始画面生成的 `assets/previews/pelican.svg`，避免预览持续运行其动画。

## Contributors 通过 Issue 添加作品

推送本项目后，在仓库打开 **Issues → New issue → 添加网页作品**，填写项目标识、名称、简介、分类、可选标签和完整 HTML。模板会自动使用 `[作品提交]` 标题前缀；请保留此前缀，并直接在最后的 HTML 字段粘贴源码，表单会自动添加代码围栏。

只有 GitHub Contributors API 返回的、具有实际提交贡献记录的账号可以收录。Issue 作者和本次提交或编辑者都必须通过验证；仓库所有者、协作者或 `author_association` 身份不构成额外放行条件。GitHub 的 Contributors 名单可能有缓存，新贡献者未被识别时，可以等待名单更新后编辑 Issue 重试。任何人仍可以创建 Issue，但未通过校验的内容不会修改仓库或部署。

收录成功时，Action 会一次提交两个文件：

- 新增 `demos/<项目标识>/index.html`。
- 在 `data/projects.json` 添加作品及 `submission: { issue, author }` 来源信息，日期使用处理当天的 UTC 日期。

随后机器人会在 Issue 回复提交链接并关闭 Issue，同一次工作流直接调用 Pages 部署。收录与部署分别显示为 Actions 任务，Issue 关闭表示文件已收录；是否已上线请查看部署任务结果。无需额外 PAT：`GITHUB_TOKEN` 创建的提交通常不会再次触发普通 `push` 工作流，因此这里直接复用部署工作流。Pages 取得部署锁后读取分支最新内容，避免较早的 Issue 运行覆盖较新的发布。

同一 Issue 重跑不会重复新增项目；如果上次收录成功但部署失败，重新运行该工作流会再次发布。新的 Issue 不能覆盖已有项目 ID 或 HTML 文件。已收录作品的修改请通过正常提交或 Pull Request 完成。

提交格式与权限要求：

- 项目标识最长 48 个字符，只允许小写字母、数字和中间的单个连字符。
- 名称最长 80 个字符，简介最长 240 个字符，标签最多 6 个、每个最长 24 个字符。
- HTML 最多 55 KiB，Issue 正文最多 64 KiB，须包含完整文档结构和非空 `title`。建议把 CSS / JavaScript 内联在一个 HTML 中；此入口不会下载附件或外部文件。
- HTML 作为网页源文件保存，提交中的 JavaScript 不在 CI 执行，页面打开后可以运行。卡片预览仍使用受限 iframe。
- 默认分支必须允许这个工作流使用 `GITHUB_TOKEN` 写入。分支保护或仓库规则阻止写入时会失败并说明原因，不会绕过保护。无需给非 Contributor 仓库写权限。
- 仓库须启用 Issues 和 GitHub Actions，并将 **Settings → Pages → Source** 设为 **GitHub Actions**。

格式错误时编辑 Issue 即可重新校验；遇到临时 API 或权限问题，修复后可在 Actions 重新运行任务。多个 Issue 的提交使用原子 Git 更新与有限重试，不强制推送。

## 本地检查

使用 Node.js 22 或更新版本运行：

```bash
node --test --test-isolation=none tests/*.test.mjs
```

测试覆盖数据格式、搜索与排序、安全 URL、页面资源、GitHub Pages 子路径，页内预览的导航、尺寸切换、加载恢复和关闭清理，以及 Issue 权限验证、字段解析、重复提交、并发和部署输出。完整检查结果和环境限制见 [docs/verification.md](docs/verification.md)。

## 文件结构

```text
.
├── index.html                 # 作品集主页
├── style.css                  # 页面样式与响应式布局
├── main.js                    # 项目加载与交互
├── favicon.svg                # 站点图标
├── data/projects.json         # 项目列表
├── assets/                    # 本地资源；previews/ 可放自定义截图
├── demos/                     # 独立 HTML 项目
├── scripts/                   # Issue 解析与原子收录脚本
├── tests/                     # 本地自动化检查
├── .nojekyll                  # 关闭 Jekyll 处理
└── .github/
    ├── ISSUE_TEMPLATE/add-project.yml
    └── workflows/
        ├── deploy.yml
        └── issue-project.yml
```

修改站点名称及介绍时，编辑 `index.html` 中的标题、描述和相关文本。所有资源均随站点部署；浏览项目不依赖外部字体、图片服务或 API。
