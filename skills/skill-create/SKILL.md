---
name: skill-create
description: 指导在当前工作区创建、编写、审查和验证可复用的 Agent Skill。
whenToUse: 当用户要求创建或修改 Skill，或需要把一类重复任务沉淀为 SKILL.md 时使用。
---

# SkillCreate：编写高质量 Skill

## 目标与边界

Skill 是给 Agent 的可复用工作说明，不是产品代码，也不是把系统提示词重复一遍。先明确它解决的任务、触发条件、输入输出和完成标准；只写对该任务真正有帮助的约束。

## 工作区隔离

- 当前工作区的 Skill 必须放在 `.dsh/skills/<skill-name>/SKILL.md`。不要默认写入用户级 `~/.dsh/skills`，也不要把一个项目的规则复制到另一个项目。
- `<skill-name>` 使用小写 kebab-case，例如 `api-review`；目录名和 frontmatter 的 `name` 保持一致。
- 可选资源放在同一 Skill 目录下的 `references/`、`scripts/`、`assets/`；在正文中用相对路径引用。
- 创建前确认当前 cwd 属于哪个工作区；验证时至少从当前工作区加载一次，并确认另一个工作区看不到它。

## 最小文件格式

`SKILL.md` 必须以 YAML frontmatter 开始：

```markdown
---
name: api-review
description: Review API changes for compatibility, security, and test coverage.
whenToUse: Use when reviewing a public API or endpoint change.
---

# API Review

按下面的步骤执行……
```

`name` 必须是 kebab-case，`description` 要说明能力和适用场景，而不是只写"帮助开发"。可按需使用 `disable-model-invocation: true` 或 `user-invocable: false` 控制调用入口。

## 推荐正文结构

1. **触发与目标**：什么时候使用，最终交付什么。
2. **前置检查**：需要读取哪些文件、确认哪些上下文、哪些情况应停止并提问。
3. **执行流程**：按顺序写成可操作步骤；复杂分支用小节或决策表。
4. **质量门槛**：验证命令、审查清单、失败处理和完成定义。
5. **示例**：只保留能消除歧义的输入、输出或命令。
6. **资源索引**：把较长参考资料移到 `references/`，不要把正文膨胀成百科全书。

## 编写原则

- 用祈使句和明确动作，避免"适当处理""确保质量"这类不可验证的表述。
- 先写最常见路径，再写例外；让 Agent 能在有限上下文中渐进式加载细节。
- 不依赖隐含的工作目录、工具、环境变量或网络；没有这些条件时写出替代方案或明确失败信息。
- 不在 Skill 中保存密钥、个人数据或与任务无关的项目规则。
- 复用现有 Skill 的术语和工具名，避免同一事实出现多个互相矛盾的版本。

## 发布前验证

- 检查 frontmatter 能被解析，`name`、`description` 和目录名一致。
- 从一个真实任务触发 Skill，确认步骤足够具体且不会覆盖用户意图。
- 验证引用的文件、脚本和命令存在；脚本要说明输入、输出和错误码。
- 检查正文是否能独立阅读，是否把长资料正确放入资源目录。
- 用当前工作区的 cwd 查询技能目录，再换到其他工作区查询，确认没有跨工作区泄漏。

## 交付清单

完成时报告 Skill 名称、`SKILL.md` 路径、适用触发条件、验证结果以及尚未覆盖的边界。
