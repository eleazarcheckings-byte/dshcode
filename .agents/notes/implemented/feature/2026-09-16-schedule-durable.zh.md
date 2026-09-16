# Agent Note: 跨重启持久化、绑定工作区的定时任务

Status: implemented

[English](2026-09-16-schedule-durable.md) | 中文

## 问题

harness 中唯一的调度原语是 `@deepseek-ai/dsh-schedule`:一条从单个 Session 自身事件日志折叠而来的提醒,以后续消息的形式送回该 Session。它的投递模式明确是 `session-local` 的——一个冷却或关闭的 Session 会让到期的提醒一直处于逾期状态,直到未来某个存活的根 Agent 恢复它,而一条固定速率规则是锚定在创建它的那个 Session 上的。SaturnBot 有自己的持久化循环调度器,但那是一个带有规划器、固定角色与渠道适配器的常驻业务自动化循环——而不是一个通用的"按计划运行这个"原语;为了一个任意的 cron 或一次性任务而复用它,就意味着为了完全用不到的目的去引入它全部的机制。harness 中没有任何东西能让一个任务在 harness 重启后存活、绑定在工作区而非 Session 上,或使用日历风格的 cron 语法——这正是相对于 Claude Code 自身定时例程（scheduled routines）的差距所在。

## 决策

`@deepseek-ai/dsh-schedule-durable` 是一个新包,与 `dsh-schedule` 并存组合,而非取代它。每一个持久化字段——id、name、prompt、workspace、cron-或-once 规则、status、`nextFireAt`、`lastFiredAt`——都通过 `dsh-storage-domain` 语义层持久化(一个 `schedule_durable` 领域,内含一张 `tasks` 表),而绝不通过 Session 日志;本包不声明任何 `SessionEventMap` 成员。Cron 解析是一个内置的小型 5 字段解析器(minute hour day-of-month month day-of-week,UTC),而非引入新依赖:它把每个字段拆解为取值集合,并从决策时刻起以分钟粒度向前搜索候选时刻,同时对不可能匹配的整月、整天、整小时进行快进跳过,因此一条不可达的规则(例如把 day-of-month 限定为 31,却把 month 限定在一个没有 31 号的月份集合中)仍会在有界的十年地平线内终止,而不会无限循环。协调决策——`reconcileTask(task, nowMs)`——是一个显式时刻的纯函数:内部不调用 `Date.now()`,因此每个测试都可以提供自己的时钟,从而确定性地断言"恰好一次补触发"行为,而不必与真实定时器赛跑。补触发在构造上就是恰好一次的,而非靠计数器实现:一个到期任务的下一次发生时刻永远是严格晚于协调时刻重新计算出来的,而不是从错过的那次发生时刻向前推进,因此无论错过了多少次,一次协调都只会触发该任务一次,并将其重新安排到正确的未来目标;`resume` 遵循完全相同的规则,因此被恢复的任务永远不会回放它被暂停期间的那段间隔。触发任务与对触发采取行动被分离开:本包通过 `ctx.get('scheduleDurableDispatcher')` 以鸭子类型方式解析一个 `TaskDispatcher`,与 `@saturnai/dsh-model-router` 中记录的 model-router 语义层完全一致,若未配置,触发会通过 `ctx.logger` 被记录,并报告为 `{ kind: 'dispatched', detail: 'no scheduleDurableDispatcher configured; no action was taken' }`,而不是被静默丢弃,也不会假装发生了某个动作。

## 考虑过的替代方案

**由本包在每次触发时直接启动一个全新的 agent 会话。** 最初的任务书要求派发操作通过现有的 agent/session API 在任务的工作区中启动一个全新的 agent 会话。对 `@deepseek-ai/dsh-subagent` 的调查发现,其 `ctx.subagents.start()` 语义层需要一个存活的发起 Agent:其自身文档指出,进程内提供者是从发起 Agent 的持久化会话状态中推导工作区、谱系与委派深度的,而一次无头的重启时协调根本没有这样的 Agent——当 harness 刚刚启动、没有任何打开的会话时,根本不存在可供派生的存活 Agent。搭建一个冷启动安全的顶层会话引导机制超出了本包的独占写入范围(仅限 `packages/schedule/schedule-durable/**`),并且会触及本次会话规则所禁止修改的 Agent/Session 技术栈。派发器语义层才是诚实的边界:本包只负责准确判断一个任务何时到期并恰好触发一次;触发之后做什么是部署层面的集成决策,应当作为一项已知限制被记录下来,而不是用一个在没有父 Agent 时每次实际运行都会失败的 agent-spawn 调用来掩盖问题。

**把这套机制并入 `dsh-schedule` 自身的 Session 日志折叠逻辑。** 予以否决,因为这两种投递模型在持久化层面是不兼容的:`dsh-schedule` 刻意以 Session 日志为权威来源(严格重放、感知 fork 的 `ownEvents()` 截断、无外部渠道),而一个绑定工作区的任务必须完全独立于任何一个 Session 的日志而存活。与其并存组合而非扩展它,才能让两套契约都保持干净,也符合任务书中明确禁止修改会话级包的边界。

**借用 SaturnBot 的调度器。** 任务书本身就否决了这一点,经检查也得到证实:SaturnBot 的 `scheduler.ts`/`engine.ts` 与其自身的规划器/专家模型角色及渠道适配器(`BotOrchestrator`、`BotAgent`、`propose`/`plan`)绑定在一起,而不是一个通用的"触发一个任务"原语;为了一个任意的 cron 任务而采用它,就意味着毫无理由地引入一整套业务自动化循环。

## 后果

部署方今天就能获得跨重启持久化的调度能力,并且在显式接入派发器之前不产生任何副作用:仅挂载插件本身是安全的(无出站发送、无会话变更、无 agent 派生),这与最初任务书中"本包只调度、不执行动作"的范围边界相符。接入一个真正的派发器——最有用的场景是启动一个 agent 会话——被推迟到未来的一次集成,而那次集成首先需要一个本包不负责搭建的冷启动安全会话引导机制。目前尚未接入任何 bundle 行或 preset 行;这两项都已列在本包的集成需求中,留给编排者添加(在 `packages/bundle/base/cordis.patch.yml` 中加入一行 `- id: schedule-durable`,以及对应的 `tsconfig.base.json` 路径与根 tsconfig 引用),因为本包的独占范围禁止自行编辑上述任何文件。

## 验证

`node_modules/.bin/vitest run packages/schedule/schedule-durable`——4 个文件、30 个测试,全部通过:cron 解析拒绝字段数错误、越界项、反向区间与非法步长,并将 day-of-week 的 7 折叠为 0;下一次触发搜索覆盖了纯通配符、显式的分钟/小时目标、滚动到次日、步长值、星期几列表、月末跳过(day-of-month 31 对应一个 30 天的月份)、day-of-month/day-of-week 的 OR 连接、2 月 29 日只在闰年命中,以及一条不可达规则(2 月 30 日)报告 `undefined` 而不是陷入死循环;存储层在两个独立的、指向同一 JSON 后端根目录的 `Context` 之间(模拟一次重启)完整保留了 id、cron、下一次触发时刻与 workspace,以幂等的方式二次删除,并在手工构造的、`status` 取值超出封闭词汇表的磁盘记录上以 `invalid-record` 响亮失败;`reconcileTask` 证明了在错过两次 `*/10` 发生之后恰好触发一次(落在严格晚于决策时刻的下一个 `*/10` 时隙上,而非被错过的那些),证明了一次性任务的完成,也证明了即便 `nextFireAt` 早已过期,暂停状态依然会抑制触发;`resumeNextFireAt` 证明了 cron 重新计算、仍处于未来的一次性任务原样通过,以及已过期一次性任务在下一次协调时补触发这三种情形;`ScheduleDurableRuntime.reconcileAll` 针对一个真实的、由 storage-domain 支撑的存储与一个注入的派发器,端到端地证明了相同的恰好一次行为,并单独证明了在未配置派发器时默认的记录型派发器会介入;插件组合测试证明了符合 Loader 规范的函数插件导出形状(无默认导出、`unwrapExports` 往返一致),在无需任何存活 Agent 的情况下针对真实的 `ToolRuntime` 注册并执行全部五个工具,以各自稳定的错误代码拒绝了非绝对路径的 workspace 以及 cron/at 二者都提供或都未提供的选择器,并通过创建一个近未来的一次性任务、让其过期、销毁 Context、再在同一根目录上重新打开一个全新的 Context,证明了重启后的补触发会在挂载时自动运行。`node_modules/.bin/tsc -p packages/schedule/schedule-durable/tsconfig.json --noEmit` 干净退出。
