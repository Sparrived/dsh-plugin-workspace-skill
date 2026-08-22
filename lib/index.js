/**
 * dsh-plugin-workspace-skill
 *
 * A Cordis plugin for DSH that provides two capabilities:
 *
 * 1. `skill-create` runtime skill — guidance for authoring high-quality
 *    reusable agent skills (SKILL.md format, structure, review checklist).
 *    Inspired by OpenAI Codex's `skill-creator` system skill.
 *
 * 2. Workspace-level skill isolation — a `ctx.skills` provider that loads
 *    skills from `<workspace-root>/.dsh/skills/` and exposes them ONLY to
 *    sessions whose cwd belongs to that workspace. Workspace skills outrank
 *    user-level and bundled sources (rank 700), so a project can override a
 *    same-named global skill without leaking it to other workspaces.
 *
 * Discovered layouts under the workspace root:
 *   .dsh/skills/<skill-name>/SKILL.md   (directory bundle, resources allowed)
 *   .dsh/skills/<skill-name>.md         (flat markdown file)
 */

/** kebab-case skill name grammar enforced by the host registry. */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const LF = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const BACKSLASH = String.fromCharCode(92)

export const name = 'workspace-skill'

export const inject = ['skills', 'fs', 'workspaceRegistry']

function normalizePath(value) {
  return String(value).replaceAll(BACKSLASH, '/')
}

function joinPath(...parts) {
  const normalized = parts.map(normalizePath)
  const first = normalized.shift() || ''
  const cleanedFirst = first.length > 1 ? first.replace(/\/$/, '') : first
  const rest = normalized
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
  return [cleanedFirst].concat(rest).filter((part) => part.length > 0).join('/')
}

function isMissing(error) {
  return Boolean(error) && (
    error.code === 'ENOENT' ||
    error.code === 'ENOTDIR' ||
    error.code === 'FS_NOT_FOUND' ||
    error.code === 'FS_NOT_DIRECTORY'
  )
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw signal.reason || new Error('The skill lookup was aborted')
  }
}

function parseScalar(value) {
  const text = value.trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  if (text === 'true' || text === 'yes' || text === 'on') return true
  if (text === 'false' || text === 'no' || text === 'off') return false
  return text
}

/**
 * Parse one SKILL.md document: YAML frontmatter limited to flat
 * `key: value` fields (name/description/whenToUse/invocation flags),
 * followed by the markdown body.
 */
function parseSkillDocument(raw) {
  const lines = String(raw).split(LF)
  if (lines.length < 3 || lines[0].replaceAll(CR, '') !== '---') return undefined

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replaceAll(CR, '') === '---') {
      closing = index
      break
    }
  }
  if (closing < 0) return undefined

  const fields = {}
  for (const line of lines.slice(1, closing)) {
    const match = line.replaceAll(CR, '').match(/^([A-Za-z][A-Za-z0-9-]*):[ ]*(.*)$/)
    if (match) fields[match[1]] = parseScalar(match[2])
  }

  const skillName = typeof fields.name === 'string' ? fields.name.trim() : ''
  const description = typeof fields.description === 'string' ? fields.description.trim() : ''
  if (!SKILL_NAME_PATTERN.test(skillName) || description.length === 0) return undefined

  const whenToUse =
    typeof fields.whenToUse === 'string' && fields.whenToUse.trim().length > 0
      ? fields.whenToUse.trim()
      : undefined

  return {
    name: skillName,
    description,
    whenToUse,
    invocation: {
      modelInvocable: fields['disable-model-invocation'] !== true,
      userInvocable: fields['user-invocable'] !== false
    },
    content: lines.slice(closing + 1).join(LF).trim()
  }
}

async function readSkill(ctx, filePath, signal) {
  throwIfAborted(signal)
  let target
  try {
    target = await ctx.fs.resolve(filePath, { signal })
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') return undefined

  const parsed = parseSkillDocument(await ctx.fs.readText(target, signal))
  if (parsed === undefined) return undefined

  const normalizedFilePath = normalizePath(filePath)
  const suffix = '/SKILL.md'
  const directory = normalizedFilePath.endsWith(suffix)
    ? normalizedFilePath.slice(0, -suffix.length)
    : normalizedFilePath.slice(0, normalizedFilePath.lastIndexOf('/'))

  return { ...parsed, path: target.displayPath, directory }
}

/**
 * Resolve the workspace owning `cwd`: the deepest registered workspace whose
 * canonical directory contains it. Returns undefined when cwd matches none.
 */
async function workspaceFor(ctx, cwd, signal) {
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined
  throwIfAborted(signal)

  const cwdTarget = await ctx.fs.resolve(cwd, { signal })
  let winner
  for (const workspace of ctx.workspaceRegistry.list()) {
    throwIfAborted(signal)
    const workspacePath = workspace.path
    if (typeof workspacePath !== 'string') continue
    try {
      const workspaceTarget = await ctx.fs.resolve(workspacePath, { signal })
      if (
        ctx.fs.contains(workspaceTarget, cwdTarget) &&
        (winner === undefined || normalizePath(workspacePath).length > winner.path.length)
      ) {
        winner = { path: normalizePath(workspacePath) }
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return winner
}

async function discoverWorkspaceSkills(ctx, config, cwd, signal) {
  const workspace = await workspaceFor(ctx, cwd, signal)
  if (workspace === undefined) return []

  const rootPath = joinPath(workspace.path, config.rootDir)
  let rootTarget
  try {
    rootTarget = await ctx.fs.resolve(rootPath, { signal })
    const rootInfo = await ctx.fs.stat(rootTarget, signal)
    if (rootInfo === undefined || rootInfo.type !== 'directory') return []
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }

  let entries
  try {
    entries = await ctx.fs.listDir(rootTarget, signal)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }

  const candidates = []
  for (const entry of entries) {
    throwIfAborted(signal)
    let filePath
    let directory
    if (entry.type === 'directory') {
      filePath = joinPath(entry.target.displayPath, 'SKILL.md')
      directory = normalizePath(entry.target.displayPath)
    } else if (entry.type === 'file' && entry.name.endsWith('.md')) {
      filePath = normalizePath(entry.target.displayPath)
      directory = rootPath
    } else {
      continue
    }

    const parsed = await readSkill(ctx, filePath, signal)
    if (parsed === undefined) continue

    candidates.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      source: config.source,
      provider: config.providerName,
      rank: config.rank,
      locator: { filePath, directory },
      resourceBase: { kind: 'directory', path: directory },
      path: parsed.path
    })
  }
  return candidates
}

/** The bundled `skill-create` guidance body. */
function guideContent() {
  return [
    '# SkillCreate：编写高质量 Skill',
    '',
    '## 目标与边界',
    '',
    'Skill 是给 Agent 的可复用工作说明，不是产品代码，也不是把系统提示词重复一遍。先明确它解决的任务、触发条件、输入输出和完成标准；只写对该任务真正有帮助的约束。',
    '',
    '## 工作区隔离',
    '',
    '- 当前工作区的 Skill 必须放在 `.dsh/skills/<skill-name>/SKILL.md`。不要默认写入用户级 `~/.dsh/skills`，也不要把一个项目的规则复制到另一个项目。',
    '- `<skill-name>` 使用小写 kebab-case，例如 `api-review`；目录名和 frontmatter 的 `name` 保持一致。',
    '- 可选资源放在同一 Skill 目录下的 `references/`、`scripts/`、`assets/`；在正文中用相对路径引用。',
    '- 创建前确认当前 cwd 属于哪个工作区；验证时至少从当前工作区加载一次，并确认另一个工作区看不到它。',
    '',
    '## 最小文件格式',
    '',
    '`SKILL.md` 必须以 YAML frontmatter 开始：',
    '',
    '```markdown',
    '---',
    'name: api-review',
    'description: Review API changes for compatibility, security, and test coverage.',
    'whenToUse: Use when reviewing a public API or endpoint change.',
    '---',
    '',
    '# API Review',
    '',
    '按下面的步骤执行……',
    '```',
    '',
    '`name` 必须是 kebab-case，`description` 要说明能力和适用场景，而不是只写“帮助开发”。可按需使用 `disable-model-invocation: true` 或 `user-invocable: false` 控制调用入口。',
    '',
    '## 推荐正文结构',
    '',
    '1. **触发与目标**：什么时候使用，最终交付什么。',
    '2. **前置检查**：需要读取哪些文件、确认哪些上下文、哪些情况应停止并提问。',
    '3. **执行流程**：按顺序写成可操作步骤；复杂分支用小节或决策表。',
    '4. **质量门槛**：验证命令、审查清单、失败处理和完成定义。',
    '5. **示例**：只保留能消除歧义的输入、输出或命令。',
    '6. **资源索引**：把较长参考资料移到 `references/`，不要把正文膨胀成百科全书。',
    '',
    '## 编写原则',
    '',
    '- 用祈使句和明确动作，避免“适当处理”“确保质量”这类不可验证的表述。',
    '- 先写最常见路径，再写例外；让 Agent 能在有限上下文中渐进式加载细节。',
    '- 不依赖隐含的工作目录、工具、环境变量或网络；没有这些条件时写出替代方案或明确失败信息。',
    '- 不在 Skill 中保存密钥、个人数据或与任务无关的项目规则。',
    '- 复用现有 Skill 的术语和工具名，避免同一事实出现多个互相矛盾的版本。',
    '',
    '## 发布前验证',
    '',
    '- 检查 frontmatter 能被解析，`name`、`description` 和目录名一致。',
    '- 从一个真实任务触发 Skill，确认步骤足够具体且不会覆盖用户意图。',
    '- 验证引用的文件、脚本和命令存在；脚本要说明输入、输出和错误码。',
    '- 检查正文是否能独立阅读，是否把长资料正确放入资源目录。',
    '- 用当前工作区的 cwd 查询技能目录，再换到其他工作区查询，确认没有跨工作区泄漏。',
    '',
    '## 交付清单',
    '',
    '完成时报告 Skill 名称、`SKILL.md` 路径、适用触发条件、验证结果以及尚未覆盖的边界。'
  ].join(LF)
}

export function apply(ctx, config = {}) {
  const resolved = {
    providerName: typeof config.providerName === 'string' && config.providerName.length > 0
      ? config.providerName
      : 'workspace-isolated',
    rootDir: typeof config.rootDir === 'string' && config.rootDir.length > 0
      ? config.rootDir
      : '.dsh/skills',
    source: typeof config.source === 'string' && config.source.length > 0
      ? config.source
      : 'workspace',
    rank: Number.isFinite(config.rank) ? config.rank : 700,
    registerGuideSkill: config.registerGuideSkill !== false
  }

  if (resolved.registerGuideSkill) {
    ctx.skills.register({
      name: 'skill-create',
      description: '指导在当前工作区创建、编写、审查和验证可复用的 Agent Skill。',
      whenToUse: '当用户要求创建或修改 Skill，或需要把一类重复任务沉淀为 SKILL.md 时使用。',
      source: 'runtime',
      content: guideContent(),
      metadata: { isolation: 'workspace', root: resolved.rootDir }
    })
  }

  ctx.skills.registerProvider(() => ({
    name: resolved.providerName,
    async list(options) {
      return discoverWorkspaceSkills(ctx, resolved, options && options.cwd, options && options.signal)
    },
    async get(candidate, options) {
      if (!candidate || !candidate.locator || typeof candidate.locator.filePath !== 'string') {
        return undefined
      }
      const parsed = await readSkill(ctx, candidate.locator.filePath, options && options.signal)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        invocation: parsed.invocation,
        source: resolved.source,
        provider: resolved.providerName,
        resourceBase: { kind: 'directory', path: parsed.directory },
        path: parsed.path,
        content: parsed.content
      }
    }
  }))
}
