---
description: "为尚未挂载已发布 dsh-web-app Team 行的 Web composition 提供 Agent Teams 浏览器层。"
kind: "package-bundle"
---

# @saturnai/dsh-agent-team-web-profile

[English](README.md) | 中文

## 概述

`@saturnai/dsh-agent-team-web-profile` 是 [Agent Teams](../../saturn/agent-team/README.zh.md) 的 Web 层：一个 `insert`，为 [`@saturnai/dsh-client-ui-agent-team`](../../client/ui-agent-team/README.zh.md) 添加 `ui-agent-team` 行。

已发布的 `@deepseek-ai/dsh-web-app` bundle 已经拥有这一行，以及 Team service 与工具行，因此标准 Web profile 不需要本包的任何内容。只有在 Web composition 没有挂载 bundle 自带的 Team 行时才添加它，且绝不能叠加在其之上：`ui-agent-team` id 被声明两次会让 Loader 抛出 `duplicate loader entry id`，导致整棵插件树加载失败。每个 composition 中该行只有一个归属。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

在本仓库 checkout 中，把 Web 层添加到已初始化、且 composition 尚未挂载已发布 Team 行的 `web` profile：

```sh
pnpm dsh plugin --profile web add ./packages/bundle/agent-team-web-profile
```

base-backed（非 Web）profile 的 Host Team 层是 [`@saturnai/dsh-agent-team-profile`](../agent-team-profile/README.zh.md)；标准 Web profile 两者都不需要，因为 `@deepseek-ai/dsh-web-app` 已经声明了全部三行。执行 `dsh plugin --profile web remove @saturnai/dsh-agent-team-web-profile` 移除本包时，Web 层也会从 profile 的有序 bundle 列表中移除。

### 获得的功能

对话标题栏会获得 Team roster、共享任务板与 teammate 导航。[`@saturnai/dsh-client-ui-agent-team`](../../client/ui-agent-team/README.zh.md) 负责这些浏览器交互，并挂载用于访问 Host Team service 的生成 Client Remote namespace。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包的运行时内容是 [`cordis.patch.yml`](cordis.patch.yml)。在 `dsh-web-app` 与 Host Agent Teams 层之后应用时，它唯一的 `insert` 条目会为 `@saturnai/dsh-client-ui-agent-team` 添加 `ui-agent-team` 行。插入的 Client 插件负责生成的 Remote assembly 与 Team UI；这个静态 bundle 不持有可变状态，也不安装运行时不变式。

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 包含 `ui-agent-team` 行的有序 Web patch |
| [`src/index.ts`](src/index.ts) | 空模块入口；patch 是运行时内容 |
| — | 不发布运行时不变式伴生入口；本包是静态 bundle，不持有可独立观察的运行时关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [晋升记录](../../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——位置、发布族与依赖隔离。
- [Agent Teams Host profile](../agent-team-profile/README.zh.md)——base-backed 的 domain、Remote 与模型工具层。
- [Agent Teams 浏览器 UI](../../client/ui-agent-team/README.zh.md)——roster、任务板与 teammate 导航行为。
- [Web bundle](../../bundle/web-app/README.zh.md)——拥有已发布 Team 行的浏览器层。

-----

<a id="model-experience"></a>
## 模型体验

通过与本 Web 层同时选择的 Host-side Agent Teams profile 间接产生影响。

#### KV Cache 影响

本 Web bundle 不添加任何模型请求内容；Host-side Team 工具负责提示词、schema 与缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **有序组合**——当本层确实被使用时，它挂载在 composition 自带的 `dsh-web-app` 等价 base 之后，且该 base 不得同时提供 `ui-agent-team` id。
- **Preset-scoped 旧控制项**——稳定 Web preset 仍会在 preset scope 内挂载 continuable Subagent 控制项。顶层 Host profile override 不会替换这些 scoped registration，因此在 Web 获得 Team-aware preset 前，Team roster 与旧 child 控制项可能同时出现。[Web Agent Teams 决策](../../../.agents/notes/implemented/feature/2026-08-06-agent-teams-web.zh.md)记录了这项暂缓的 composition 工作。
- **已发布表层拥有该行**——`@deepseek-ai/dsh-web-app` 声明了 `ui-agent-team`，因此标准 Web profile 已经显示该面板，不得再添加本包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
