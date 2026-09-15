---
description: "跨部署的模型分级设置命名空间与 resolve() 服务，以及挂载原生 Claude Code / Codex 子代理提供方的开关。"
kind: "package-reference"
---

# @saturnai/dsh-model-router

[English](README.md) | 中文

## Summary

`@saturnai/dsh-model-router` 拥有一个设置命名空间 `saturn-model-router`，其中命名了四个路由分级——`coordinator`、`specialist`、`bulk`、`vision`——每个分级要么是显式的 `{ provider, model, reasoningEffort? }` 路由，要么是 `'default'`。调用方应通过 `ctx.modelRouter.resolve(tier)` 取得路由,而不是硬编码一条路由：留在 `'default'` 的分级会跟随当前的 `agent-default-model`,因此提高部署默认模型会同时提升所有尚未被覆盖的分级。同一命名空间还携带 `externalHarnesses`——一个默认关闭(新安装即关闭)的单一开关,由某个 Bundle 行或预设工具行据此决定是否挂载原生的 Claude Code / Codex 子代理提供方——每一个仍会在其自身的包内平台 CLI 包未安装时自我隐藏,因此仅仅打开开关本身绝不会让一个背后空无一物的工具出现。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

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
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ModelRouterService` 通过 `ctx.settings.register` 注册该命名空间,后者按顺序解析模式默认值、组合层的 `base`(此处没有——每个字段都有模式默认值)以及用户层;`resolve()` 在每次调用时读取当前注册状态,而不是缓存快照,因此编辑该命名空间会在下一次 `resolve` 时生效,无需重启。回退到 `agentDefaultModel` 是一次鸭子类型的 `ctx.get('agentDefaultModel')` 读取,而不是硬依赖,这与 SPEC §4 中的接口契约(`ctx.modelRouter`,C6 → C5/C8a)一致:从未挂载 `agent-default-model` 的组合仍会把每个 `'default'` 分级解析为随包附带的 DeepSeek V4 Flash 兜底值,而不是抛出异常。

`harnessAvailable()` 是针对每个原生工具自身 npm 包(`@deepseek-ai/dsh-subagent-codex`、`@deepseek-ai/dsh-subagent-claude-code`)的 `require.resolve` 探测,锚定在本包自身的模块上——`cordis` 预设的 SKILL.md 编写指南将它们记录为捆绑了各自“包内平台 CLI”,因此包的可解析性本身就是 CLI 是否存在的判据,而不是 `PATH` 查找或派生探测。结果按进程缓存:某个可选依赖是否已安装在进程运行期间不会改变,而一次派生探测会带来禁用表达式求值器(一次同步的 `eval`)无法等待的延迟与副作用。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [llm-pi-ai](../../llm/llm-pi-ai/README.zh.md) — base bundle 中精选的免密钥配置所填充的多提供方适配器。
- [agent-default-model](../../core/agent-default-model/README.zh.md) — `'default'` 分级回退所依据的部署默认值。
- [Editing Cordis compositions](../../preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md) — 本包的开关所取代的原生子代理 Bundle 安装模式。
- [settings](../../settings/settings/README.zh.md) — 命名空间注册接缝。

-----

<a id="model-experience"></a>
## Model Experience

None, as this package resolves routing and mount decisions for other Host plugins and never contributes prompt text, tool schemas, or model-visible content of its own.

### Token effect

Zero-direct:此处的任何内容都不会进入模型请求。某个分级解析出的 `provider`/`model` 决定了消费者自身请求使用哪个适配器与模型 id,因此其上下文影响完全归属于该消费者。

### KV Cache effect

Independent:本包不持有任何按请求或按会话的状态,而更改某个分级的路由是消费者层面的变化(有时是不同的模型,有时是不同的提供方),其缓存影响归属于该消费者自身的适配器,而非本路由器。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **本包不附带客户端卡片** ——该设置命名空间能够正确解析与校验,但将其渲染为可编辑的“Plugins”卡片属于本包未包含的 `packages/client/*` 贡献;在有人添加之前,该命名空间需直接在 `settings.yaml` 中编辑。
- **`harnessAvailable()` 会在进程生命周期内缓存** ——在进程启动之后安装某个工具包(不通过常规的 `pnpm install` + 重启流程)在下次重启之前不会被感知到。
- **`resolve()` 不校验目标路由是否存在** ——显式的分级覆盖若指向一个未注册的提供方或未知的模型 id,只有在消费者自身的适配器拒绝该请求时才会被发现。
- **不校验每个分级的推理强度是否与目标模型能力匹配** ——目标模型不支持的强度等级属于消费适配器自身的失败模式(参见 `dsh-llm-pi-ai` 的 `UNSUPPORTED_OPTION` / 推理能力处理)。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

本 Dev Note 为非权威性的工作上下文:尚未决定的方向与给维护者的说明。已发布的行为与已采纳的理由记录在上述各节、包代码与相关 Agent Notes 中。

- 把 `ctx.modelRouter.resolve('specialist')` 接入真正的 `tool-subagent` 派生路径,以及接入 SaturnBot 的规划者/专家模型选择,属于本 cell 不拥有的包(`tool-subagent`、`saturnbot`)中的消费端改动;参见本 cell 的 `integration_needs`。
- 为 `saturn-model-router` 编写 `settings.plugin.item` 客户端卡片——分级选择器加外部工具开关——是 `ui-settings-models` 提供方选择器的自然搭档,本包尚未构建它。

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond the settings registration enforced at its owning seam.
