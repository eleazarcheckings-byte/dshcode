# Agent Note:apps/mobile —— 后台定时任务改用有边界的回放端点(Mars r3 R3-F1)

状态:已实现

[English](2026-09-15-apps-mobile-replay-endpoint.md) | 中文

## 问题

Mars r3(`M3-apps-mobile-r3.md`,阻塞性发现 R3-F1)证明了针对 R2-F1 的上一版修复本身在 iOS 上就是坏的。那
版修复让后台 runner 的定时任务直接读取主机保持打开的 `GET /saturn/remote/events` SSE 流:带一个
`Last-Event-ID` 请求头,并用 8 秒的读取截止时间去限定 `response.body.getReader()`。插件自己提交的 Swift
源码证伪了这次读取所依赖的前提:
`node_modules/@capacitor/background-runner/ios/Sources/RunnerEngine/JSResponse.swift` 的
`JSResponseExports` 只暴露了 `ok`/`status`/`url`/`text()`/`json()`——没有 `body`,也没有
`ReadableStream`;而 `JSFetch.swift` 的 `fetch()`(基于 `URLSession.dataTask`)返回的 Promise 只会在
completion handler **内部**才 resolve,也就是说必须等整个响应体都缓冲完才会 resolve。因此对一条主机从不
自行关闭的流执行 fetch,在 iOS 上根本不会 resolve——这与 R2-F1 指出的挂起属于同一类问题,只是从
`response.text()` 挪到了 `fetch()` 调用本身,而且不读插件已提交的源码根本发现不了(整个过程没有涉及任何
真机)。Android 的引擎是以预编译原生 `.aar` 形式提供的,本仓库里没有它的源码,所以流式读取在 Android 上同
样是"未经证实",而不是"已被证伪"——Mars r3 对两端都做了标记。

## 决定

- **改用 SPEC.md §8 的有边界回放契约,而不是 SSE 流。** `scripts/background-runner.entry.js` 的
  `checkRemoteEvents` 定时任务现在调用
  `GET <hostUrl>/saturn/remote/events/replay?after=<lastSeen>&limit=100`,用一次 `response.json()` 读完
  整个响应——这条路径在两个平台上都完全不涉及 `response.body`,因此 Mars r3 发现的那一类问题在这里没有对
  应物。`after` 首次运行时从 `0` 开始,此后取自上一次触发持久化的 id。
- **分页截断,但有上限。** 当响应报告 `truncated: true`(可用事件多于 `limit`)时,本次触发会在同一轮里
  最多再取 `MAX_REPLAY_PAGES = 5` 页,每次都推进 `after`,这样较大的积压事件不用等好几个 15 分钟周期才能
  消化完——同时仍然给单次 OS 定时任务设了上限,以应对异常或有问题的主机。
- **`gap: true` 不需要特殊分支。** 当请求的 `after` 比主机环形缓冲区所保留的最旧 id 还要旧时,响应会从实
  际保留的最旧事件开始,像普通页面一样处理;部分事件已经不可恢复地丢失,但游标仍会正确地推进到主机接下来
  所报告的位置。`hasReplayGap()` 让这种情况可观测、可测试,但不改变定时任务本身的行为。
- **游标推进永不倒退。** `resolveReplayCursor(reportedNewest, observedNewest)` 在主机报告的 `newest` 字段
  按数值解析后位于或领先于本页实际触发过通知的最高 id 时采用它,否则退回到实际观测到的 id——因此一个缺失
  或格式错误的 `newest`(或者错误地报告了比刚刚投递的还旧的值)永远不会让持久化的游标倒退。
- **`src/lib/backgroundEventsCore.js` 移除了 `parseSseFrames`。** 它解析的是 SSE 帧格式的文本;而回放端
  点在这条路径上返回的永远是单个 JSON 对象,不是 SSE 正文——继续保留它就会是这次任务书里点名的"死掉的能
  力分支"。取而代之的是 `parseReplayEvents`、`hasReplayGap`、`isReplayTruncated`、`resolveReplayCursor`
  这几个纯函数,作为定时任务与其重新生成的 `assets/background-runner.js` 共享的、有测试覆盖的表面(仍然通
  过 `scripts/backgroundRunnerBuild.mjs` 内联——这一点没变,隔离引擎依旧没有模块加载器)。
- **数值 id 排序与通知 `extra` 结构在实质上没有变化。** `compareEventIds`/`isNewerEventId`/
  `mapBackgroundEvent`(R2-F2/R2-F3)依旧把关并塑形每一条被调度的通知;`isNewerEventId` 作为逐事件的防御
  性检查被保留了下来,即便契约已经保证了返回的 id 严格大于 `after`——开销很低,而且能防止某个分页边界的怪
  异情况导致重复通知。
- **提交了共享的 Xcode scheme。** `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme`(启用
  build、test、launch、profile、archive 五种 action,`BuildableReference` 指向
  `504EC3031FED79650016851F`——从 `project.pbxproj` 中读到的 `App` target 自身标识符)。一个兄弟分支 M5
  的提交(`37a454920ec84abcb1e6bdd9ff7738db721f1324`)已经记录了缺少这个文件会导致的 CI 失败,并为此添加
  了一道 `xcodebuild -list` 守卫;这次提交补上了这道守卫所期待的那个文件。`ios/.gitignore` 忽略的是
  `xcuserdata`,不是 `xcshareddata`,所以这里不需要改动 gitignore。
- **README 更正,双语言,“后台事件投递”。** 重写为如实描述回放机制(依赖操作系统自身节奏的、有边界的轮
  询;iOS 的 BGAppRefresh/BGTaskScheduler 节奏由系统而非本应用控制),新增了“为什么不用 SSE 流”一节,直
  接引用那两个 Swift 源文件,并新增了一段“跨轮次的修复历史”把 r1/r2/r3 串联起来。已通过
  `pnpm run verify-translation-pairing --write` 重新记录 `README.i18n.yaml`。

## 本分支进行期间的一次实时并发写入事件(是被观察到的,不是本分支造成的,在本次提交时已经解决)

会话进行到一半时,`apps/mobile/src/lib/remoteApi.ts`、`backgroundSync.ts`、`main.ts` 在磁盘上发生了变
化——那时本分支正在工作——同时工作区里出现了一个未纳入版本控制的 `tests/remoteApi.test.ts`(把
`RemoteEventsClient` 钉死为完全没有 `pollOnce()`)——这些都不是本分支做的。当时的 `git reflog` 显示
`HEAD` 已经比本分支自己最后一次提交前进了大约十个提交,其中包括 `1321a485b5`
(`test(saturn): RED for the mobile RemoteEventsClient -- EventSource-only, no pollOnce()`)、
`f49a3ffaad`(`fix(saturn): mobile RemoteEventsClient drops the never-resolving pollOnce() -- EventSource-only`),
以及一对针对某个无关的 `saturnbot` 提交的 `undo racy commit` / `restore dropped commit`——这直接证明了
确实有另一个活跃进程正在向 `apps/mobile/**`(按 SPEC.md §8 M3 的划分,本应只属于本分支一个写入方)提交
内容,并且共享分支上确实发生过至少一次真实的 `git commit` 竞态。本分支在此期间没有做任何提交,也没有做
任何破坏性的 git 操作:只用只读方式检查了状态(`git status`、`git diff`、`git show`),而不是直接暂存;
没有删除那个未纳入版本控制的测试文件(删除它可能会销毁某个并发会话尚未提交、唯一存在的真实工作成果);
并且把本分支自己对 README 的编辑,在与并发工作重叠的那一段(`pollOnce()` 的状态描述)上按下不表,以免第
二个写入方去否定一项已经在同一处代码上进行中的修复。等到准备提交这次改动时,`f49a3ffaad` 与
`1321a485b5` 已经干净地落地,`remoteApi.ts` 里已经没有 `pollOnce()`,`apps/mobile` 的完整测试套件是
8/8 个文件、72/72 个测试全部通过,并且反复检查 `git status` 也没有再看到 `apps/mobile/**` 里出现新的
变动。这一段是治理记录本身;按“持续自我改进”这条法则,这与本次会话里
`2026-09-15-model-router-mars-r2-fixes.md` 的“新增测试文件,而非修改已提交的 RED 文件”一节已经点名过的
模式属于同一种(一个已停止/重复的代理留下了未提交的改动)——值得 `system-evolve` 去审视一下:
`apps/mobile/**` 的单分支独占写入保证,是否也需要用上 C5 正在构建的 worktree 隔离能力,而不只是用在初次
构建上,也用在修复轮次的派发上。

## 与修复清单的偏离(明确声明,不做默默改动)

除上文因并发情况而做出的范围取舍外,没有其他偏离:任务书里的每一项 DELIVER(切换回放端点、纯核心测试、
漂移守卫、Xcode scheme、README 如实更正、`npm test`/`tsc`/`npm run build`/Gradle)都已按要求完成。

## 考虑过的替代方案

**保留流式读取,但加一个运行时特性检测(`typeof response.body?.getReader === 'function'`),只有在不存在
时才退回到回放端点。** 被否决:Mars r3 的修复清单把这作为选项 (b) 提出时,明确要求配一个“*真正能用*的非
流式回退——而在 iOS 上这需要 (a),因为 `fetch` 本身就不会 resolve”。既然 fetch 调用本身就会在任何针对
响应的特性检测有机会运行之前就卡住,那么在这个本来就是为了保护它而设的平台上,特性检测什么都买不到;它只
会多出第二条从未被真正走到过的代码路径(和被移除的流式代码是同一种"死掉的能力分支")。

## 结果

**代价:** 这次定时任务在一轮里最多可能发起 5 次先后的 HTTP 请求,而不是保持一条流打开去读(有上限,而且
只有在积压确实大到触发截断时才会发生);每一次都是普通的一问一答,没有持久连接,所以即便在最坏情况下,
单次请求的开销也低于流式连接的持续开销。

**收获:** 后台通知路径在 iOS 上终于是可达的了,而在本轮之前,无论测试怎么显示,它都是不可达的——
`parseReplayEvents`/`hasReplayGap`/`isReplayTruncated`/`resolveReplayCursor` 都是纯函数且有完整覆盖;定
时任务本身(网络加系统调度)仍未在真机上验证,这一点在 README 中如实披露,与此前每一轮保持一致。

## 测试

新增:`tests/backgroundEventsCore.test.ts` 增加了 `parseReplayEvents`(结构良好的响应体、缺失/非数组的
`events`、非对象载荷——均不抛出异常)、`hasReplayGap`/`isReplayTruncated`(各自的标志位及其缺省情况),以
及 `resolveReplayCursor`(reported 领先、reported 缺失/格式错误、reported 落后于 observed,以及一次模拟
的两页截断分页触发,验证最终游标落在正确位置)——共 9 条新断言,先确认 RED 再提交
(`test(saturn): RED for the mobile background-runner replay contract (Mars r3 R3-F1)`,修复前确认 9 个失
败 / 8 个通过),之后未再修改;此后只新增了测试文件/用例,符合规则。同一次 RED 提交里移除了现已死亡的
`parseSseFrames` 相关 describe 块(是死代码清理,不是行为回归——本轮之后仓库里再没有任何地方 import 它)。

完整结果(在上文所述并发的 `pollOnce()` 移除落地之后):在 `apps/mobile` 内执行
`node_modules/.bin/vitest run`——8/8 个测试文件、72/72 个测试全部通过。`node_modules/.bin/tsc -p
tsconfig.json --noEmit` 干净无输出。`npm run build` 成功(prebuild 重新生成的
`assets/background-runner.js` 与既有提交逐字节一致,`tests/backgroundRunnerGenerated.test.ts` 与构建自身
的输出都证实了这一点)。`pnpm run verify-translation-pairing apps/mobile/README.md` 在 `--write` 重新记
录 `README.i18n.yaml` 之后报告“1 named pair(s) consistent”。Gradle 的 `assembleDebug` 结果以及 Xcode
scheme 的 XML 良构性校验,按“不做文档堆叠”的原则,逐字记录在 report_path 中,此处不再重复。

## 遗留

通过 APNs/FCM 实现真正的锁屏即时推送(超出本分支范围,自功能说明以来一直未变);在任一平台上对一次真实
的、由操作系统调度的定时任务进行真机验证。
