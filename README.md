# dsh-plugin-workspace-skill

[中文](#中文) | [English](#english)

<a id="中文"></a>

一个 [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) Cordis 插件，提供两个能力：

1. **`skill-create` 技能** —— 指导 Agent 在当前工作区创建、编写、审查和验证可复用 Skill（`SKILL.md` 格式规范、正文结构、发布前验证清单）。设计参考了 OpenAI Codex 的 [`skill-creator`](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) 与 [Skills 文档](https://github.com/openai/codex/blob/main/docs/skills.md)，并结合 DSH 的技能注册机制做了适配。
2. **工作区级 Skill 隔离** —— 一个 `ctx.skills` provider，把 `<workspace>/.dsh/skills/` 目录作为"仅当前工作区可见"的技能来源。一个项目里的私有 Skill 不会泄漏到其他工作区，还能按名字覆盖全局技能。

## 工作区隔离如何工作

每次技能发现时，provider 会：

1. 用调用方的 `cwd` 在 `workspaceRegistry` 中找出**包含它的最深注册工作区**（通过 `fs.contains` 规范比较，兼容 Windows 路径分隔符）。
2. 扫描该工作区根目录下的 `.dsh/skills/`，支持两种布局：
   - `.dsh/skills/<skill-name>/SKILL.md` —— 目录包，可携带 `references/`、`scripts/`、`assets/` 等资源；
   - `.dsh/skills/<skill-name>.md` —— 单文件扁平布局。
3. 解析 YAML frontmatter（`name` / `description` / `whenToUse` / `disable-model-invocation` / `user-invocable`），以 `rank: 700` 注册候选。

优先级：**工作区技能 > 用户级与内置来源**。同名时工作区版本胜出，因此项目可以安全地覆盖全局技能；`cwd` 不属于任何注册工作区时，此 provider 不产生任何候选。

## 安装

### 方式一：`dsh plugin add`（官方流程，推荐）

本包在 `package.json` 里声明了 `dsh.bundle.patch: ./cordis.patch.yml`（补丁清单就是下面的插件行），因此能被 dsh 识别为一个 profile 层：

```bash
# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-plugin-workspace-skill

# 或直接从 GitHub 安装
dsh plugin --profile web add github:Sparrived/dsh-plugin-workspace-skill

# 或从本地 checkout 安装（相对路径 spec 会被锚定为绝对路径）
dsh plugin --profile web add D:\Code\dsh-plugin-workspace-skill
```

`dsh plugin` 会在 profile 目录（`$DSH_HOME/profiles/<name>`）内转发 pnpm 完成安装，并把声明了 `dsh.bundle` 的依赖自动写入该 profile 的 `dsh.profile.bundles` 层列表。本包是纯 ESM、无构建步骤，无需 pnpm `allowBuilds` 放行。启动后可用 `dsh --profile web --dump-config` 确认 `workspace-skill` 行已进入组合树。

### 方式二：手动加插件行

不经过 bundle 机制时，直接在宿主 `cordis.yml` 或自定义 agent preset 的组合里写同一行：

```yaml
- id: workspace-skill
  name: dsh-plugin-workspace-skill
  # 可选配置：
  # config:
  #   providerName: workspace-isolated
  #   rootDir: .dsh/skills
  #   source: workspace
  #   rank: 700
  #   registerGuideSkill: true
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `providerName` | `workspace-isolated` | provider 名称 |
| `rootDir` | `.dsh/skills` | 相对工作区根目录的技能目录 |
| `source` | `workspace` | 候选的 source 标记 |
| `rank` | `700` | 排序优先级（越大越优先） |
| `registerGuideSkill` | `true` | 是否同时注册 `skill-create` 指导技能 |

插件声明 `inject: ['skills', 'fs', 'workspaceRegistry']`；停止或卸载时，provider 与运行时技能随 Cordis Fiber 一并撤销。

### 方式三：动态插件（临时试用）

在 DSH 会话里用动态 Cordis 插件加载 `lib/index.js` 的等价代码（`cordis_define` → `cordis_run`），无需改任何组合文件。注意动态插件只存活于当前进程。

### 方式四：只要指导技能本身

不需要隔离 provider 的话，直接把 [`skills/skill-create/SKILL.md`](skills/skill-create/SKILL.md) 复制到用户级 `~/.dsh/skills/skill-create/SKILL.md` 或某个项目的 `.dsh/skills/skill-create/`，DSH 内置文件系统 provider 即可发现它。

## 编写一个工作区 Skill

```
<workspace>/
└── .dsh/
    └── skills/
        └── api-review/
            ├── SKILL.md
            ├── references/
            │   └── checklist.md
            └── scripts/
                └── check-breaking.sh
```

```markdown
---
name: api-review
description: Review API changes for compatibility, security, and test coverage.
whenToUse: Use when reviewing a public API or endpoint change.
---

# API Review

按下面的步骤执行……
```

要点：

- `name` 必须是小写 kebab-case，并与目录名一致；
- `description` 写清能力与适用场景；
- 资源放同目录下，正文中用相对路径引用。

## 验证

1. 在目标工作区内发起会话，确认 `skill-create` 出现在技能目录中；
2. 创建 `.dsh/skills/hello-isolation/SKILL.md`，确认它只在当前工作区可见，换到另一个工作区的会话后不可见；
3. 在用户级目录放置同名技能，确认工作区版本胜出；
4. 停用插件后确认以上技能全部消失（无残留副作用）。

---

## English

A [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) Cordis plugin with two capabilities:

1. **The `skill-create` skill** — guides an agent through creating, writing, reviewing, and validating reusable skills in the current workspace (`SKILL.md` format rules, body structure, pre-publish checklist). Inspired by OpenAI Codex's [`skill-creator`](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md) and its [Skills docs](https://github.com/openai/codex/blob/main/docs/skills.md), adapted to DSH's skill registration mechanism.
2. **Workspace-level skill isolation** — a `ctx.skills` provider that treats `<workspace>/.dsh/skills/` as a skill source visible **only to sessions inside that workspace**. A project's private skills never leak into other workspaces, and can override global skills by name.

## How workspace isolation works

On every skill discovery, the provider:

1. Finds the **deepest registered workspace containing the caller's `cwd`** in `workspaceRegistry` (canonical comparison via `fs.contains`, tolerant of Windows path separators).
2. Scans `.dsh/skills/` under that workspace root, supporting two layouts:
   - `.dsh/skills/<skill-name>/SKILL.md` — directory bundle with optional `references/`, `scripts/`, `assets/`;
   - `.dsh/skills/<skill-name>.md` — flat single-file layout.
3. Parses the YAML frontmatter (`name` / `description` / `whenToUse` / `disable-model-invocation` / `user-invocable`) and registers candidates with `rank: 700`.

Precedence: **workspace skills > user-level and bundled sources**. Same-named workspace skills win, so a project can safely override global ones; when `cwd` belongs to no registered workspace this provider contributes nothing.

## Install

### Option 1: `dsh plugin add` (official flow, recommended)

The package declares `dsh.bundle.patch: ./cordis.patch.yml` in `package.json` (the patch list is the plugin row below), so dsh recognizes it as a profile layer:

```bash
# from npm (once published)
dsh plugin --profile web add dsh-plugin-workspace-skill

# or straight from GitHub
dsh plugin --profile web add github:Sparrived/dsh-plugin-workspace-skill

# or from a local checkout (relative path specs are anchored to absolute paths)
dsh plugin --profile web add D:\Code\dsh-plugin-workspace-skill
```

`dsh plugin` forwards to pnpm inside the profile directory (`$DSH_HOME/profiles/<name>`), then automatically adds any dependency declaring `dsh.bundle` to that profile's `dsh.profile.bundles` layer list. This package is pure ESM with no build step, so no pnpm `allowBuilds` approval is needed. After booting, verify the `workspace-skill` row landed in the composed tree with `dsh --profile web --dump-config`.

### Option 2: add the plugin row manually

Without the bundle mechanism, write the same row directly in a host `cordis.yml` or a custom agent preset composition:

```yaml
- id: workspace-skill
  name: dsh-plugin-workspace-skill
  # Optional configuration:
  # config:
  #   providerName: workspace-isolated
  #   rootDir: .dsh/skills
  #   source: workspace
  #   rank: 700
  #   registerGuideSkill: true
```

| Option | Default | Description |
| --- | --- | --- |
| `providerName` | `workspace-isolated` | Provider name |
| `rootDir` | `.dsh/skills` | Skill directory relative to the workspace root |
| `source` | `workspace` | Source tag on candidates |
| `rank` | `700` | Sort precedence (higher wins) |
| `registerGuideSkill` | `true` | Also register the `skill-create` guide skill |

The plugin declares `inject: ['skills', 'fs', 'workspaceRegistry']`; on stop or uninstall the provider and the runtime skill unwind with the Cordis Fiber.

### Option 3: dynamic plugin (quick trial)

Load equivalent code via a dynamic Cordis plugin inside a DSH session (`cordis_define` → `cordis_run`) without touching any composition file. Note dynamic plugins only live for the current process.

### Option 4: just the guide skill

If you don't need the isolation provider, copy [`skills/skill-create/SKILL.md`](skills/skill-create/SKILL.md) into user-level `~/.dsh/skills/skill-create/SKILL.md` or a project's `.dsh/skills/skill-create/` — DSH's built-in filesystem provider discovers it.

## Authoring a workspace skill

```
<workspace>/
└── .dsh/
    └── skills/
        └── api-review/
            ├── SKILL.md
            ├── references/
            │   └── checklist.md
            └── scripts/
                └── check-breaking.sh
```

```markdown
---
name: api-review
description: Review API changes for compatibility, security, and test coverage.
whenToUse: Use when reviewing a public API or endpoint change.
---

# API Review

Follow the steps below...
```

Key points:

- `name` must be lowercase kebab-case and match the directory name;
- `description` states the capability and when it applies;
- keep resources next to `SKILL.md` and reference them with relative paths.

## Verify

1. Start a session inside the target workspace and confirm `skill-create` appears in the skill catalog;
2. Create `.dsh/skills/hello-isolation/SKILL.md`, confirm it is visible only in this workspace and invisible from another workspace's session;
3. Place a same-named skill at user level and confirm the workspace version wins;
4. Stop the plugin and confirm all of the above disappear (no residual side effects).

## License

[MIT](LICENSE)
