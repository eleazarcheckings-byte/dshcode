---
description: "composer 多任务切换：conversation.input.left 席位覆盖 orchestrate 投影，并接入 /orchestrate 命令通道。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-orchestrate

[English](README.md) | 中文

## 概述

composer 工具行上的多任务切换控件：一个占用 `conversation.input.left` 的双状态控件，位于权限触发器旁边。状态通过标准套件的 `useProjection` 跟随 host 的 `orchestrate` 投影；点击会通过 `command.execute` 执行 `/orchestrate on|off`，因此该控件与斜杠命令共享同一条已记录的事件和同一条结果行。多任务行为本身（`/orchestrate` 命令、`orchestrate` 投影单元、策略提示词片段）由 `@saturnai/dsh-orchestrate` 拥有，在 host 名册上独立组合——此包只负责展示。

## 目录

- [渲染内容](#what-it-renders)
- [状态约定](#state-contract)
- [组合方式](#composition)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="what-it-renders"></a>
## 渲染内容

该切换控件同时渲染两种状态——多任务模式默认关闭，因此一个只在开启时才出现的控件会隐藏用来打开它的开关。`aria-pressed` 报告当前实际生效的状态，绝不报告排队中的目标状态；待生效的变更通过带点标签展示，而不是把目标状态画成已经落地的样子。切换失败时会在按钮旁显示一行内联、未本地化的错误文本（错误界面策略：失败文案保持英文）。

组件通过 `useProjection('orchestrate')` 订阅 `orchestrate` 会话投影。当 host 未组合该行时，投影键只是简单地不存在，组件不渲染任何内容——能力缺失就是该键的缺失，绝不是某个特殊取值。

-----

<a id="state-contract"></a>
## 状态约定

三种状态，三种不同的画法——绝不仅靠颜色（izzy，2026-09-16：“thats fine, make sure the button indicates when its on /off it always looks like the same right now”，大意：那没问题，但要让按钮能表明它此刻是开还是关，现在它看起来总是一个样）：

| 状态 | 类名 | 填充 / 边框 | 标签 | `aria-pressed` |
|---|---|---|---|---|
| OFF | `.off` | 透明，细描边 `--dsw-alias-border-l2` | `OFF`（弱化墨色） | `false` |
| ON | `.on` | 填充 `--saturn-accent`，无边框 | `ON`（`--saturn-void` 墨色） | `true` |
| PENDING | `.pending`（叠加在 `.off`/`.on` 之上） | 叠加一圈虚线描边，颜色取自排队中的 `data-target` | 标签仍显示当前生效状态 | 不变——仍是当前生效状态 |

`ON`/`OFF` 等宽标签（`toggle.tag.on` / `toggle.tag.off`——在两种语言词典中都保持不翻译，与 `@saturnai/dsh-client-ui-done` 的 `VerdictCard` 对 `PASS`/`REVISE`/`REJECT` 采用的同一套"教义词元"惯例一致）位于"多任务"标签旁边，并且在隐藏标签的窄 composer 断点下依然保留，因此状态始终以文字可读，绝不仅仅依赖填充颜色。`aria-pressed` 与标签始终与 `active` 一致；排队中的翻转只会叠加虚线 `pending` 圈以及"将在下一步生效"的标题——绝不会把切换控件画成好像已经生效的样子。切换控件的背景/边框/文字颜色过渡搭乘共享的 `--saturn-dur-1` / `--saturn-ease-standard` 动效令牌，并在 `prefers-reduced-motion: reduce` 下禁用。

-----

<a id="composition"></a>
## 组合方式

占用 `conversation.input.left`（由 `@saturnai/dsh-client-ui-conversation` 声明的、会话作用域的 `list` 类型 slot），以 `id: 'multi-task'`、`order: 10` 注册，并通过 `ctx.locale` 注册 `orchestrate` 语言命名空间。这两项注册都搭在 `ctx.slots.inject`/`ctx.effect` 上，因此每当声明该 slot 的包或语言注册表本身在 HMR 下重新加载时，这个席位和它的词典会一起安装、一起撤回——不会有过期条目在其注册模块之后继续存活。Host 导出（`lib/index.js`）是一个空的 `apply()`：此包不提供任何自身的 node 侧行为，只通过 `exports["./client"]` 提供浏览器半侧。

所需客户端服务：`slots`、`remote`、`remote.commands`、`locale`（在 `inject` 中声明）。

-----

<a id="model-experience"></a>
## 模型体验

### composer 切换控件展示

#### 模型可见内容

此包本身不直接向模型呈现任何内容。点击切换控件会通过与操作者手动输入斜杠命令相同的 `remote.commands.execute` 路径执行 `/orchestrate on|off`；该命令自身的模型可见策略片段与投影由 `@saturnai/dsh-orchestrate` 拥有，而非由这个展示席位拥有。

#### Token 影响

无。按钮及其标签、忙碌/错误状态完全是浏览器本地状态；此包渲染的任何内容都不会被复制进模型请求。

#### KV Cache 影响

没有直接影响。一次成功的切换会改变 `orchestrate` 投影，进而可能改变 `@saturnai/dsh-orchestrate` 在后续提示词中组装的策略片段——但那部分缓存效应属于该命令自身的包，不属于这个展示席位。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 该控件没有独立状态：投影读取失败或 `orchestrate` 行未组合时都不渲染任何内容，"未组合"与"加载中"没有区分的错误提示。
- 切换控件总是指向当前生效状态的相反值；不存在独立的开/关一对控件，只有单一的翻转操作。
- 失败文案刻意保持仅限英文（错误界面策略），不在 `orchestrate` 语言命名空间的覆盖范围内。
- 排队圈的颜色只标出排队中的 ON 目标（`--saturn-accent`）；排队中的 OFF 目标沿用与静止 OFF 描边相同的颜色，因此在这条路径上圈本身不携带额外信号——标题和 `aria-pressed` 仍然携带。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
