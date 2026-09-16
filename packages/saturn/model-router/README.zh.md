---
description: "跨部署的模型分级设置命名空间与 resolve() 服务，以及挂载原生 Claude Code / Codex 子代理提供方的开关。"
kind: "package-reference"
---

# @saturnai/dsh-model-router

[English](README.md) | 中文

## 概述

`@saturnai/dsh-model-router` 拥有一个设置命名空间 `saturn-model-router`，其中命名了四个路由分级——`coordinator`、`specialist`、`bulk`、`vision`——每个分级要么是显式的 `{ provider, model, reasoningEffort? }` 路由，要么是 `'default'`。调用方应通过 `ctx.modelRouter.resolve(tier)` 取得路由,而不是硬编码一条路由：留在 `'default'` 的分级会跟随当前的 `agent-default-model`,因此提高部署默认模型会同时提升所有尚未被覆盖的分级。同一命名空间还携带 `externalHarnesses`——一个默认关闭(新安装即关闭)的单一开关,由某个 Bundle 行或预设工具行据此决定是否挂载原生的 Claude Code / Codex 子代理提供方——每一个仍会在其自身的包内平台 CLI 包未安装时自我隐藏,因此仅仅打开开关本身绝不会让一个背后空无一物的工具出现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Host 层挂载一次插件即可(共享的 base bundle 已经携带它)。之后任何一行——子代理派生、SaturnBot、某个 Bundle 的 `disabled` 表达式——都通过鸭子类型的 `ctx.get('modelRouter')` 读取,因此省略此包的组合会退化为“无路由器”而不是挂载失败。

### 解析一个分级

```ts
const route = ctx.modelRouter.resolve('specialist')
// { provider: 'deepseek-official', model: 'deepseek-v4-flash' } until either
// the user sets `saturn-model-router.tiers.specialist` or raises the agent
// default model.
```

### 配置分级

通过该命名空间的 Plugins 设置卡片编辑,或直接编辑 `settings.yaml`：

```yaml
saturn-model-router:
  tiers:
    specialist: default
    bulk:
      provider: llm-pi-ai
      model: gpt-5-mini
      reasoningEffort: low
  externalHarnesses: false
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `tiers.coordinator` | `'default'` | 编排级工作的路由;在被覆盖前跟随部署默认模型 |
| `tiers.specialist` | `'default'` | 子代理派生默认请求的路由 |
| `tiers.bulk` | `'default'` | 大批量机械性工作的路由 |
| `tiers.vision` | `'default'` | 携带图像的请求的路由 |
| `externalHarnesses` | `false` | 当对应的包已安装时,挂载原生的 Claude Code / Codex 子代理提供方 |

### 让某个 Bundle 行或预设工具行依据外部工具挂载状态门控

```yaml
- id: subagent-codex
  name: '@deepseek-ai/dsh-subagent-codex'
  disabled: !!js ctx.get('modelRouter')?.externalHarnessMounted('codex') !== true
```

`externalHarnessMounted(harness)` 是每个门控都应使用的唯一检查:它等于 `externalHarnessesEnabled() && harnessAvailable(harness)`,因此使用它的行绝不会仅因开关打开就挂载,也绝不会为一个安装失败的工具包挂载工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`ModelRouterService` 通过 `ctx.settings.register` 注册该命名空间,后者按顺序解析模式默认值、组合层的 `base`(此处没有——每个字段都有模式默认值)以及用户层;`resolve()` 在每次调用时读取当前注册状态,而不是缓存快照,因此编辑该命名空间会在下一次 `resolve` 时生效,无需重启。回退到 `agentDefaultModel` 是一次鸭子类型的 `ctx.get('agentDefaultModel')` 读取,而不是硬依赖,这与 SPEC §4 中的接口契约(`ctx.modelRouter`,C6 → C5/C8a)一致:从未挂载 `agent-default-model` 的组合仍会把每个 `'default'` 分级解析为随包附带的 DeepSeek V4 Flash 兜底值,而不是抛出异常。

`harnessAvailable()` 是一次两阶段的 `require.resolve` 探测,而不是仅针对每个原生工具自身包装包的单次检查。仅探测包装包(`@deepseek-ai/dsh-subagent-codex`、`@deepseek-ai/dsh-subagent-claude-code`)会产生假阳性:只要该包装包在模块图中的任何地方被声明——例如某个消费者的 `devDependencies`——即使它实际依赖的平台 CLI 未能安装或在生产安装中被剪除,探测仍会成功。`harnessCliResolvable()` 转而分两步进行:(1) 用一个锚定在本包上的解析器解析包装包自身的 `package.json`;(2) 再用一个锚定在该清单上的 `require` 解析包装包真正依赖的 CLI(`codex` 对应 `@openai/codex`;`claude-code` 对应 `@anthropic-ai/claude-agent-sdk`),并同时尝试该 CLI 说明符的裸形式与其 `/package.json` 子路径形式、两者任一成功即可——两个 CLI 包并不共享同一种可解析形式:`@openai/codex` 没有 `main`/`exports` 字段(只有 `bin`),因此只有 `/package.json` 能解析成功;`@anthropic-ai/claude-agent-sdk` 声明了包含 `.` 条目但不含 `./package.json` 条目的 `exports` 映射,因此只有裸说明符能解析成功。只有两个阶段都成功,该工具才算可用。结果按进程缓存:某个包是否已安装在进程运行期间不会改变,而一次派生探测会带来禁用表达式求值器(一次同步的 `eval`)无法等待的延迟与副作用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [llm-pi-ai](../../llm/llm-pi-ai/README.zh.md) — base bundle 中精选的免密钥配置所填充的多提供方适配器。
- [agent-default-model](../../core/agent-default-model/README.zh.md) — `'default'` 分级回退所依据的部署默认值。
- [Editing Cordis compositions](../../preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md) — 本包的开关所取代的原生子代理 Bundle 安装模式。
- [settings](../../settings/settings/README.zh.md) — 命名空间注册接缝。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只为其他 Host 插件解析路由与挂载决策，从不贡献自己的提示词文本、工具 schema 或模型可见内容。

#### KV Cache 影响

独立：本包不持有任何按请求或按会话的状态,且不会直接触及任何模型请求。某个分级解析出的 `provider`/`model` 决定了消费者自身请求使用哪个适配器与模型 id;更改某个分级的路由是消费者层面的变化(有时是不同的模型,有时是不同的提供方),其缓存影响完全归属于该消费者自身的适配器,而非本路由器。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **本包不附带客户端卡片** ——该设置命名空间能够正确解析与校验,但将其渲染为可编辑的“Plugins”卡片属于本包未包含的 `packages/client/*` 贡献;在有人添加之前,该命名空间需直接在 `settings.yaml` 中编辑。
- **第一阶段(包装包自身)锚定于本包自身的依赖声明** ——`@deepseek-ai/dsh-subagent-codex` 与 `@deepseek-ai/dsh-subagent-claude-code` 被声明为 `@saturnai/dsh-model-router` 的 `optionalDependencies`(此为恢复:Mars r2 发现上一轮曾移除这两项,导致第一阶段的解析在生产安装中含糊不清——此前它之所以能解析成功,只是因为在本检出中恰好位于会被 pnpm 从生产安装中剪除的 `devDependencies` 里)。本轮以只读方式检查了已打包的桌面应用的 `resources/app/node_modules`(`C:\Users\izzy\AppData\Local\Programs\@dshcodedesktop\resources\app\node_modules`):它是单一的扁平目录,而非 pnpm 的隔离式逐包存储,因此一旦本包随构建发布,该目录下的每个包都能被其他任意包的解析器访问到,无论各自声明了哪些依赖——`optionalDependencies` 仍是正确的声明(它记录了真实且有意的边界,并使本单体仓库中的 `pnpm install`、以及未来任何隔离式安装打包路径保持正确),只是在当前所用的扁平布局下,它并非阻止第一阶段出现假阴性的唯一因素。检查时该目录下并未出现这两个包装包(external-harnesses 功能尚未发布),因此打包应用场景仍未经端到端观测;扁平布局这一发现是关于解析机制的证据,而非关于打包开关已被实际验证过的断言。
- **`harnessAvailable()` 会在进程生命周期内缓存** ——在进程启动之后安装某个工具包(不通过常规的 `pnpm install` + 重启流程)在下次重启之前不会被感知到。
- **`resolve()` 不校验目标路由是否存在** ——显式的分级覆盖若指向一个未注册的提供方或未知的模型 id,只有在消费者自身的适配器拒绝该请求时才会被发现。
- **不校验每个分级的推理强度是否与目标模型能力匹配** ——目标模型不支持的强度等级属于消费适配器自身的失败模式(参见 `dsh-llm-pi-ai` 的 `UNSUPPORTED_OPTION` / 推理能力处理)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 为非权威性的工作上下文:尚未决定的方向与给维护者的说明。已发布的行为与已采纳的理由记录在上述各节、包代码与相关 Agent Notes 中。

- 把 `ctx.modelRouter.resolve('specialist')` 接入真正的 `tool-subagent` 派生路径,以及接入 SaturnBot 的规划者/专家模型选择,属于本 cell 不拥有的包(`tool-subagent`、`saturnbot`)中的消费端改动;参见本 cell 的 `integration_needs`。
- 为 `saturn-model-router` 编写 `settings.plugin.item` 客户端卡片——分级选择器加外部工具开关——是 `ui-settings-models` 提供方选择器的自然搭档,本包尚未构建它。

</details>

**运行时不变量：** 未发布配套包。除了在其所属接缝强制的 settings 注册之外，本包不暴露任何独立的事件序列或可变数据关系。
