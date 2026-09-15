# Agent Note: 模型路由器、精选免密钥提供方与受控原生工具

Status: implemented

[English](2026-09-15-model-router-and-external-harnesses.md) | 中文

## Problem

2026-09-15 升级(SPEC §1、§3 C6)的调研发现,端到端只挂载了一条 LLM 路由:`deepseek-official`。`@deepseek-ai/dsh-llm-pi-ai` 在 base bundle 中以“休眠”状态挂载——在 `llm-pi-ai:` 设置分区提供提供方配置之前是零路由——因此在全新安装时 Settings → Models 无可选内容。也没有“分级”这一跨部署概念(编排级路由、大批量路由、视觉路由的区分):任何想为不同工作使用不同模型的消费者都必须直接指定路由。而原生的 Claude Code / Codex 子代理提供方虽然已经是构建完整、测试齐备的包(`@deepseek-ai/dsh-subagent-codex`、`@deepseek-ai/dsh-subagent-claude-code`),却在所有地方都以禁用状态发布——启用任意一个都需要手动安装一个可选 Bundle,并手动把某个预设里的 `disabled: true` 改成 `false`,既没有部署级开关,也没有任何机制防止“工具行启用了但背后没有 Host 提供方”(或反过来)。

## Decision

**`@saturnai/dsh-model-router`**(新包,挂载在 base bundle 中)拥有一个设置命名空间 `saturn-model-router`,包含四个分级——`coordinator`、`specialist`、`bulk`、`vision`——每个分级要么是 `{ provider, model, reasoningEffort? }`,要么是 `'default'`,再加一个默认为 `false` 的 `externalHarnesses` 布尔值。`ModelRouterService.resolve(tier)` 在每次调用时读取当前注册状态:留在 `'default'` 的分级会跟随 `ctx.get('agentDefaultModel')`(鸭子类型,符合 SPEC §4 中 `ctx.modelRouter` 的契约)当其被挂载时;只有在完全没有挂载默认模型服务时,才回退到随包附带的 DeepSeek V4 Flash 路由。

同一服务还回答 `harnessAvailable(harness)`——针对每个原生工具自身 npm 包的 `require.resolve` 探测,锚定在 model-router 模块本身,并按进程缓存——以及 `externalHarnessMounted(harness) = externalHarnessesEnabled() && harnessAvailable(harness)`。每一处门控都使用这个唯一方法,因此仅打开设置开关绝不会让一个背后没有 Host 提供方的工具出现,而仅安装可选包(开关仍关闭)也不会挂载任何东西。把包的可解析性作为“CLI 是否缺失”的判据是刻意的选择——`cordis` 预设自身的编写技能文档记录了两个子代理包都捆绑了各自的“包内平台 CLI”,因此无需另外的二进制或 `PATH` 查找,而一个同步的 `!!js` 禁用表达式也无法派生/等待一个进程。

**`llm-pi-ai` 精选免密钥配置**(base bundle 的 `cordis.patch.yml`):SPEC §3 C6 指定的六个 pi-ai 内置目录提供方——`anthropic`、`openai`、`google`、`xai`、`moonshotai`、`zai`——各自配置为一个空配置(`{}`):不带 `apiKeyEnv`,因此每条路由都是“已配置但无密钥”,完全符合适配器自身文档记录的行为(它会转而依赖 pi-ai 的提供方原生环境探测,且绝不会把无密钥路由呈现为错误)。两条手工声明的本地路由 `ollama-local` 与 `lm-studio-local` 各自携带 `api: openai-completions`、指向该产品默认本地端口的 `baseURL`、一个占位 `Authorization` 头(使无密钥的本地服务器仍能收到格式良好的请求),以及一个代表性的模型 id,使该路由立即可选;用户自己在设置层的 `models` 覆盖可以纠正为其本地服务器实际提供的 id。

**Web bundle 与 `cordis` 预设的门控**:`packages/bundle/web-app/cordis.patch.yml` 中新增两个 Host 层行(`subagent-codex`、`subagent-claude-code`),各自携带 `disabled: !!js ctx.get('modelRouter')?.externalHarnessMounted(<name>) !== true`。`cordis` 预设中已有的 `tool-subagent-codex` / `tool-subagent-claude-code` 行(此前无条件 `disabled: true`)现在门控于完全相同的表达式,因此 Host 行与工具行永远不会不一致。

## Alternatives considered

**用 `PATH` 查找或派生探测来判定“CLI 是否缺失”。** 拒绝:两个子代理包都把各自的平台 CLI 作为 npm 依赖捆绑,而非期望系统安装;而 `!!js` 禁用表达式是一次同步的 `eval`,无法等待一个已派生的进程。

**强制要求挂载的 `subagent-codex`/`subagent-claude-code` Host 行必须提供 `model`。** 在阅读其 `Config` 模式后拒绝:`model` 没有默认值,但 `apply()` 代码已经把它当作可选处理(`config.model === undefined ? {} : ...`),与接口 JSDoc(“省略以继承[该产品]自身设置”)一致。以空 `config` 挂载——正是这两个包自身可选 Bundle 的 `cordis.patch.yml` 已经在用的形态——因此是正确的,而非缺陷。

**把外部工具门控折叠成单一的 `disabled` 布尔标志,而非一个方法。** 拒绝,转而采用可复用的 `externalHarnessMounted(harness)` 检查:一个裸布尔标志会诱使 Host 行与预设工具行各自重新实现(并可能失步)“enabled && available”这条逻辑。

**当 `'default'` 无法解析时,总是回退到硬编码路由。** 收窄为:仅当 `agentDefaultModel` 完全未挂载时才回退;当它已挂载时,即便其值发生变化也会持续跟随,因此提高部署默认模型会提升所有未被覆盖的分级,且无需重启。

## Consequences

- 全新安装时,Settings → Models 就有六个真实的免密钥目录提供方外加两个本地预设可选,无需先编辑设置。
- 每个分级默认跟随部署当前的 `agent-default-model`;显式的分级覆盖在一次实时设置更新后仍然保留,不会被提高部署默认值所覆盖。
- 打开 `saturn-model-router.externalHarnesses` 只会在对应可选包确已安装的情况下挂载原生 Claude Code / Codex 委派;全新安装(`externalHarnesses: false`,未安装可选 Bundle)两行都不会挂载。
- `packages/bundle/base/package.json` 新增了 `@saturnai/dsh-model-router`;`packages/bundle/web-app/package.json` 新增了 `@deepseek-ai/dsh-subagent-codex` / `-claude-code` 作为 `optionalDependencies`——二者都需要 `pnpm install` / 刷新 lockfile(集成事项,本 cell 不执行 `pnpm install`)。
- `packages/saturn/model-router` 是一个新的工作区包;在另一个包能够按包名导入它之前,需要在 `tsconfig.base.json` 的 `paths` 中新增一条(本 cell 不编辑的根配置)——本包内部测试使用相对导入(`../src/index.ts`),因此这不影响此处的验证。
- 把 `ctx.modelRouter.resolve('specialist')` 接入真正的 `tool-subagent` 派生路径以及 SaturnBot 的规划者/专家模型选择,不属于本 cell;参见本 cell 报告中的 `integration_needs`。
- 组合测试覆盖:`packages/saturn/model-router/tests/model-router.spec.ts`(设置默认值、`resolve()` 回退链、实时覆盖、工具开关独立性)与 `packages/saturn/model-router/tests/bundle-compose.spec.ts`(base/web-app/预设的 YAML 形态,包括在 `modelRouter` 存在/缺失/为真/为假时对门控表达式的 `!!js` 求值);`packages/bundle/base/tests/model-router.spec.ts`(行存在性、全新安装的 `workspace-write`+`ask` 权限默认值)与 `packages/bundle/base/tests/llm-pi-ai-profiles.spec.ts`(在精选配置上真实挂载 `dsh-llm-pi-ai`,证明每条目录路由都能列出模型,且两条本地路由都不会在挂载时抛出异常)。

## Related decisions

本笔记是 SPEC.md 记录的 2026-09-15 十单元升级中 C6 的部分;Claude Code / Codex 提供方本身,以及 `packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md` 中 `cordis` 预设的禁用模板编写指南,均先于本笔记存在,除本笔记描述的两处 `disabled` 表达式外未作改动。
