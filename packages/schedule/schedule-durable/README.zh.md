---
description: "跨重启持久化、绑定工作区的定时任务：schedule_durable_create、schedule_durable_list、schedule_durable_pause、schedule_durable_resume 与 schedule_durable_cancel 工具，供选择、配置或调试本包的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-schedule-durable

[English](README.md) | 中文

## 概述

`dsh-schedule-durable` 为部署提供能够跨越 harness 重启存活的定时任务：cron 与一次性两种形式，任务绑定在创建时的绝对工作区路径上,并支持暂停、恢复与取消，全部通过 `dsh-storage-domain` 语义层持久化,而非会话日志。它与会话级的 `@deepseek-ai/dsh-schedule` 包并存而非取代它——该包把提醒送回同一条实时对话,一旦会话结束就不再起作用;而本包的任务完全不绑定任何会话或存活的 Agent,因此即便冷启动之后,任务仍会按计划继续触发。若进程离线期间错过了一次或多次触发,任务会在下一次协调（reconciliation）时恰好触发一次,并从当前时刻重新计算下一次触发,绝不会回放积压的错过次数。触发之后实际执行的动作被委托给部署方单独组合的可插拔派发器（dispatcher）;若未配置,触发只会被记录而不采取任何进一步动作,因此本包可以独立挂载而不产生副作用。具体工具契约见[模型体验](#model-experience),派发器语义层以及本包为何不自行启动 agent 会话见[已知限制与待办事项](#known-limitations-and-deferred-work)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当一个任务必须无论是否有会话开启都持续触发时使用 Schedule-Durable——例如夜间构建、每小时健康检查,或者一个明天到期、即使无人在场也应当运行的一次性任务。若目标是把提醒送回当前对话,请改用会话级的 `@deepseek-ai/dsh-schedule` 包;若目标是拥有自己的规划器、角色与渠道适配器的常驻业务自动化循环,请改用 SaturnBot——本包只负责判断任务何时到期并把触发结果交给部署方配置的派发器。

### 挂载插件

该插件要求 `tools` 与 `storageDomain`（需先挂载一个存储后端与 `@deepseek-ai/dsh-storage-domain`）,并接受一个可选配置字段:

```yaml
- id: schedule-durable
  name: '@deepseek-ai/dsh-schedule-durable'
  config:
    pollIntervalMs: 30000
```

`pollIntervalMs` 仅控制实时进程的轮询节奏;重启后的补触发不依赖它——挂载后的第一次协调会立即运行,早于轮询间隔第一次触发之前。

### 创建、列出、暂停、恢复、取消

`schedule_durable_create` 接受非空的 `name` 与 `prompt`、一个绝对路径 `workspace`,以及 `cron`（标准 5 字段 `minute hour day-of-month month day-of-week` 表达式,按 UTC 解释）或 `at`（严格未来的四位年份 RFC 3339 UTC 时刻）二者中的恰好一个。创建成功会返回任务的完整持久化视图,包括计算出的 `nextFireAt`。`schedule_durable_list` 返回存储中的所有任务。`schedule_durable_pause` 与 `schedule_durable_resume` 接受任务 `id`;暂停一个已暂停的任务、恢复一个已激活的任务都是幂等的空操作,返回当前视图而非错误,且恢复会重新计算严格晚于当前时刻的下一次触发,而不会回放暂停期间错过的间隔。`schedule_durable_cancel` 会按 id 持久删除任务,并且是幂等的:取消一个已取消或未知的 id 会返回 `cancelled: false` 与 `task_not_found`,而不会抛出异常。

无法成为任务的输入——空的 name 或 prompt、非绝对路径的 workspace、`cron`/`at` 二者都未提供或都提供、语法非法的 cron 表达式、永远无法产生未来触发的 cron 规则、格式错误的 `at` 字符串,或非严格未来的 `at` 时刻——都会返回稳定的错误代码而非成功;封闭的错误联合类型定义在 [`src/types.ts`](src/types.ts) 中。

### 触发是如何工作的

当一个任务的 `nextFireAt` 在某次协调运行的时刻已经到期时,该任务就会触发;协调在挂载时立即运行一次,此后每隔 `pollIntervalMs` 再运行一次。触发在构造上是每次协调恰好一次的:到期任务的下一次发生时刻是严格晚于本次协调时刻重新计算出来的,而不是从错过的那次发生时刻向前推进,因此无论一个 cron 任务在进程下线期间错过了多少次,一次协调都只会触发它一次,并将它重新安排到正确的未来目标。一次性任务则会转为 `done` 并停止。触发时实际发生的事情被委托给一个通过 `ctx.get('scheduleDurableDispatcher')` 鸭子类型解析出的派发器;未配置派发器的部署依然可以正常组合——触发会被记录,不会采取进一步动作。为何接入真正的派发器（例如启动一个 agent 会话）是部署层面的集成决策而非本包自行完成的事情,见[已知限制与待办事项](#known-limitations-and-deferred-work)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释该插件背后的设计决策,并指向实现这些决策的代码;可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口:`inject`、工具注册、协调引擎,以及默认的记录型派发器 |
| [`src/store.ts`](src/store.ts) | `schedule_durable` storage-domain 声明、其 zod 记录模式,以及一个带类型的 CRUD 封装 |
| [`src/cron.ts`](src/cron.ts) | 自包含的 5 字段 cron 解析与 UTC 下一次触发搜索(不依赖任何外部 cron 库) |
| [`src/types.ts`](src/types.ts) | 持久化与面向模型的值类型;不含运行时代码 |

### 持久化,而非会话日志

每个持久化字段都存放在一个 `schedule_durable` 领域(domain)中的一张 `tasks` 表里,通过 `ctx.storageDomain`(`dsh-storage-domain` 表单,位于部署方路由到的任意后端之上,通常是 `dsh-storage-json` 或 `dsh-storage-sqlite`)打开。每条存储记录在领域打开时以及每次写入时都会针对其 zod 模式进行校验;一条校验失败的记录会让整个领域打开操作以 `invalid-record` 响亮失败,而不是默默丢弃那一条坏任务。本包不声明任何 `SessionEventMap` 成员,也不读取任何会话状态:任务的生命周期就是存储的生命周期,而非任何一个会话的生命周期。

### 协调引擎是时钟的纯函数

`src/index.ts` 中的 `reconcileTask(task, nowMs)` 是一个纯的同步函数:给定一个任务和一个墙钟时刻,它返回该任务的下一个持久化状态,以及——当该时刻越过 `nextFireAt` 时——一条派发指令;这里的任何代码都不会在内部读取 `Date.now()`。`ScheduleDurableRuntime.reconcileAll(nowMs)` 是默认情况下唯一提供实时时钟的地方,而每个测试都会改为提供一个显式时刻,这正是让"恰好一次补触发"行为可以被确定性断言、而不必与真实定时器赛跑的原因。`resumeNextFireAt` 在一个暂停任务回到 `active` 时应用同一条"严格晚于当前时刻"规则,因此恢复任务永远不会回放它被暂停期间的间隔。

### 派发语义层

`TaskDispatcher`(`src/types.ts`)是"这个任务到期了"与"发生了什么"之间唯一的语义层。`ScheduleDurableRuntime` 通过 `ctx.get('scheduleDurableDispatcher')` 以鸭子类型方式解析它,与 `@saturnai/dsh-model-router` 文档中记录的 `ctx.get('modelRouter')` 语义层完全一致:一个部署方提供的可选服务,永远不会被声明为硬性的 `inject` 依赖。若未配置,`recordingDispatcher` 会通过 `ctx.logger` 记录该次触发,并返回 `{ kind: 'dispatched', detail: 'no scheduleDurableDispatcher configured; no action was taken' }`——这是一个真实的值,而非静默的空操作,因此部署方可以从工具自身的输出中判断派发器是否已经接入。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 持久化任务管理工具

#### 模型看到什么

一旦本插件加载,模型会看到五个模式:`schedule_durable_create`、`schedule_durable_list`、`schedule_durable_pause`、`schedule_durable_resume` 与 `schedule_durable_cancel`,它们是全局注册的,不绑定到任何一个 Agent 或 Session。每个工具的确切参数与结果模式定义在 [`src/index.ts`](src/index.ts) 中;结果就是上文"使用本包"一节中描述的规范 JSON 值。

#### Token 影响

只要插件保持挂载,这五个模式就会增加固定的请求前缀。每次执行的工具都会通过常规的工具结果管线增加其依赖数据的 JSON 结果;本包不施加任何私有截断或 token 预算。

#### KV 缓存影响

只要插件保持挂载且配置不变,这五个模式就保持前缀稳定。工具调用与结果会追加到后续历史中,并保留已经可复用的前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

这些限制描述了 Schedule-Durable 何时不适合你的用例,或需要特殊的运维关注。它们是当前的包级约束,而非待办事项清单。

- **触发时没有默认动作** ——本包只负责判断任务何时到期并恰好触发一次;它本身不会启动 agent 会话、发送消息或运行命令。若 `ctx` 上没有配置 `scheduleDurableDispatcher`,触发只会被记录,不会发生任何其他事情。组合一个针对 `ctx.subagents` 启动真实 agent 会话的派发器需要一个存活的发起 Agent(其文档指出进程内提供者从发起 Agent 自身的持久化会话状态中推导工作区与谱系),而一次无头的重启时协调恰恰没有这样的 Agent;搭建一个冷启动安全的会话引导机制是部署层面的集成工作,不在本包的独占写入范围之内。
- **宿主进程必须在运行** ——协调只在 harness 进程运行期间发生;不存在云端运行器,一个在机器关闭或休眠期间到期的任务会在进程恢复后的下一次协调时触发,而非在其原定时刻触发。
- **仅支持 UTC** ——`cron` 与 `at` 均按 UTC 解释,不支持本地时区或夏令时;想要本地墙钟时间计划的调用方必须在调用 `schedule_durable_create` 之前自行换算为 UTC。
- **单一派发器,而非扇出** ——`ctx.get('scheduleDurableDispatcher')` 最多解析出一个派发器;若部署方希望不同任务对应不同动作,应当在自己的派发器实现内部完成该路由,而不是放在本包中。
- **没有错过运行的历史记录** ——任务的持久化状态只保存 `lastFiredAt`,即最近一次触发;本包不保留每一次历史触发的日志,也不记录补触发期间被跳过的发生次数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

本开发者说明是维护者的工作背景:尚未决定的开放方向。它明确不具权威性——已发布的行为、限制与已接受的理由都记录在上面各节、包代码,以及关联的 Agent Note 中。

一个冷启动安全的 agent 会话派发器(能够在没有存活父 Agent 的情况下启动一个全新的顶层会话,供 `ctx.subagents` 语义层从中派生)是部署方决定希望任务真正采取动作而不只是触发之后的自然下一步集成;目前 harness 中在存活 Agent 上下文之外不存在这样的引导机制,搭建它不在本包的独占写入范围之内。目前也没有为该插件接入任何 bundle 行或 preset 行;见 Agent Note 中的集成需求。

</details>
