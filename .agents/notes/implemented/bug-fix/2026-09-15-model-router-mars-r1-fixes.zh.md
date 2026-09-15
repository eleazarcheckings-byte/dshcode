# Agent Note：model-router —— Mars r1 修复(工具可用性探测曾是一个恒定值,而非真实探测)

状态:已实现

[English](2026-09-15-model-router-mars-r1-fixes.md) | 中文

## 问题

Mars 对 C6 的首次评审(`.../scratchpad/review/C6-model-router-providers-r1.md`)判定为 REVISE。 关键发现(F1):`ModelRouterService.harnessAvailable()` 仅通过锚定在 `model-router` 自身模块上的 `require.resolve` 探测每个原生工具的包装包(`@deepseek-ai/dsh-subagent-codex` / `-claude-code`)。这两个包装包被声明为 `model-router` 自身的 `optionalDependencies: "workspace:^"`,因此 pnpm 在每次工作区安装时都会把它们链接进 `model-router` 自己的 `node_modules`——探测在本次检出中无条件返回 `true`(Mars 已验证两者均可解析)。 README 与两处 YAML 注释却断言相反:每个原生工具"仍会在其自身的包内平台 CLI 包未安装时自我隐藏"。 覆盖该行为的单元测试(`model-router.spec.ts:103`)断言 `externalHarnessMounted('codex') === harnessAvailable('codex')`——这在结构上恒为真,因此永远无法 捕捉"包装包可解析但 CLI 缺失"这一假阳性。另外两项次要发现:该 cell 不存在已提交的 `test(saturn):` RED 提交(F2,已在原始报告中声明为偏差,而非篡改——当时并无可篡改的测试文件); `saturn-model-router` 命名空间没有 `settings.plugin.item` 客户端卡片,因此在 Settings 中不渲染任何内容 (F3,原始构建者已正确诊断为超出 C6 的 IN 范围——`packages/client/ui-settings-plugins` 属于另一个 cell)。

## 决定

- **两阶段解析,而非单次包装包探测。** 新增 `harnessCliResolvable(resolver, subagentPackage, cliPackage, createRequireFn)`:(1) 用 `resolver`(锚定在 `model-router`)解析包装包自身的 `package.json`;(2) 再用锚定在该清单上的 `require` 解析包装包*真正*依赖的 CLI——`codex` 对应 `@openai/codex`,`claude-code` 对应 `@anthropic-ai/claude-agent-sdk`(已从 `packages/subagent/subagent-codex/package.json` 与 `packages/subagent/subagent-claude-code/package.json` 自身的 `dependencies` 确认)。只有两个阶段 都成功,`harnessAvailable()` 才报告 true。这与 Node 自身从包内部加载依赖时所用的解析顺序一致, 因此一个仅因出现在某个消费者 `devDependencies` 图中而可解析的包装包,不再能冒充"CLI 已安装"。
- **移除了使探测恒为真的 `optionalDependencies`。** `model-router/package.json` 不再将 `@deepseek-ai/dsh-subagent-codex` / `-claude-code` 列为 `optionalDependencies`(它们仍保留在 `devDependencies` 中,供本包自身测试使用,而生产环境安装已发布包时不会安装 `devDependencies`)。
- **构造函数新增可注入的第二阶段解析器。** `ModelRouterService` 的构造函数新增第四个参数 `createRequireFn`(默认使用 `node:module` 的 `createRequire`),与既有的 `resolver` 参数并列—— 两者在测试中均可覆盖,在每一次真实挂载中均使用真实环境的默认值。
- **用确定性覆盖替换了同义反复断言的盲区。** 新增 `tests/harness-cli-resolution.spec.ts`,通过注入伪造的两阶段解析器,使真/假的分支不再取决于 本次检出中恰好安装了什么:包装包不存在 → false;包装包存在但 CLI 不存在 → false(正是 Mars 发现的假阳性);两者都存在 → true;并附带一个 `ModelRouterService` 层面的用例,证明当开关**打开** 但包装包可解析、其 CLI 依赖不可解析时,`externalHarnessMounted('codex')` 仍保持 `false`。 `model-router.spec.ts:103` 处的既有断言被保留(真实环境下的解析结果仍是一个值得保持的有效不变量), 并附上注释指向确定性覆盖现在所在的位置。
- **更新了 README/README.zh** 以描述两阶段检查,而非单包探测;并重新记录了翻译配对。

## 与修复清单的偏差(已声明,非隐瞒)

- **未构建 `settings.plugin.item` 客户端卡片(F3)。** 本轮再次确认: `packages/client/ui-settings-plugins` 不在 C6 的 IN 列表中(`SPEC.md` §3 C6);在此构建会侵入 另一个 cell 的范围。已作为 `integration_needs` 条目留存,与原始构建者的标记一致。
- **原始四个测试文件不存在单独的 RED 提交(F2),本轮修复也未追溯性地补一个** ——已合入的工作没有 可供"先 RED 后 GREEN"的对象。但本轮新增的行为(`harnessCliResolvable` 及其防假阳性测试)*确实* 先以 RED 提交(`test(saturn): RED — two-stage harness CLI resolution for externalHarnessMounted`,已确认针对修复前代码 5 项中有 4 项失败),随后再实现,符合 SPEC §6。
- **在 RED 提交之后、修复提交之前编辑了已提交的测试文件 `tests/harness-cli-resolution.spec.ts`**——但并非为了削弱或增加断言。RED 提交中 `ModelRouterService` 层面的用例调用了 `ctx.plugin(ModelRouterService, {}, resolver, createRequireFn)`,期望 `ctx.plugin` 转发额外的构造函数参数;而 `vendor/cordis` 的 `Registry.plugin(plugin, config, getOuterStack)` 对类插件的构造函数只会转发 `(ctx, config)`, 因此注入的伪造对象从未真正到达实例,那两个用例实际上是偶然地在真实环境下运行(恰好与本次 检出的真实解析结果一致,而非刻意设计)。修复为直接构造 `new ModelRouterService(ctx, {}, resolver, createRequireFn)`——`Service` 自身的构造函数 (`vendor/cordis/src/service.ts`)通过 `ctx.reflect.provide` 将实例注册到 `ctx` 上,独立于 插件/fiber 机制,因此直接构造是在此处注入测试替身的正确方式。没有任何断言的期望值被更改, 只改变了被测服务的构造方式。
- **未改动 `packages/bundle/base/cordis.patch.yml`、`packages/bundle/web-app/cordis.patch.yml` 或 `cordis` 预设。** 四行中的 `disabled: !!js ctx.get('modelRouter')?.externalHarnessMounted(...)` 表达式已经完全委托给 `externalHarnessMounted()`;修复该服务方法内部逻辑无需改动任何 YAML 行, `bundle-compose.spec.ts` 的 YAML 形状断言(未改动)依然通过。

## 考虑过的替代方案

**用 `--version` 之类的方式派生每个 CLI 进程,而非使用 `require.resolve` 探测。** 已否决: 禁用表达式求值器(`interpolate`,一次同步的 `!!js` `eval`)无法等待子进程,而派生探测会给 本应是廉价、同步、在每次组合加载时求值的门控增加真实延迟与副作用(启动一个进程)——这与 原始实现中已记录的"选择 `require.resolve` 而非 `PATH` 查找"的理由相同。

**直接用 `model-router` 自身的解析器探测 CLI 包,跳过包装包清单这一间接层** (即把 `@openai/codex` / `@anthropic-ai/claude-agent-sdk` 与包装包一起放进同一次扁平的解析器 调用)。已否决:这会对某个恰好可从 `model-router` 自身模块图中触达的 CLI 包报告"可用"—— 哪怕原因与该原生工具毫无关系(例如它是另一个已挂载包的传递依赖)——即使该原生工具自身的 包装包根本未安装,这正是本次修复要消除的、依赖环境的假阳性。从包装包*自身清单内部*解析 CLI, 将检查绑定在真正重要的那一条依赖边上:*这个*包装包是否拥有*它自己的* CLI。

**将 `harnessCliResolvable` 做成 `ModelRouterService` 的私有方法,而非导出函数。** 已否决: `packageResolvable` 此前就已被导出以便脱离服务直接单元测试;对称地导出 `harnessCliResolvable` 让 `tests/harness-cli-resolution.spec.ts` 能够独立于 `ModelRouterService` 的设置/上下文管线测试两阶段解析逻辑,这与原有测试套件依赖的分离方式一致。

## 结果

**成本:** `harnessAvailable()` 现在每个原生工具执行两次 `require.resolve` 调用而非一次 (仍按进程缓存,因此额外开销至多是每个进程生命周期内每个工具一次)。`ModelRouterService` 的构造函数新增了第四个参数;测试之外的每个调用点原本就使用 cordis 插件机制提供的 `(ctx, config)` 两参数形式,因此没有任何生产调用点需要改动。

**收益:** 该开关现在真正无法让一个背后空无一物的工具出现。在此修复之前,只要包装包在某个 环境中恰好可解析(根据 Mars 自身的探测,这在本次检出中确实如此,原因正是 `optionalDependencies`),打开 `externalHarnesses` 就会为一个从未真正安装的 CLI 挂载 Host 行与 预设工具行——这正是 README 与本包自身文档注释所声称不可能发生的失败模式。

## 测试

新增:`tests/harness-cli-resolution.spec.ts`(5 个测试——`harnessCliResolvable` 在注入伪造对象下的 三种解析结果,以及两个 `ModelRouterService` 层面的用例,将 `externalHarnessMounted` 钉在 "包装包可解析/CLI 缺失"这一分支的正确一侧)。已确认先出现 RED(单独提交,先于修复): 针对修复前代码,5 项中有 4 项失败——三项报 `harnessCliResolvable is not a function`, 第四项因真实环境回退而返回 `true`,与注入伪造对象所期望的 `false` 不符。修复了测试自身的 `ModelRouterService` 构造方式(见"偏差"),随后实现两阶段探测;全部 5 项转绿, `model-router.spec.ts` 与 `bundle-compose.spec.ts` 中既有的 11 项测试保持不变且仍然通过 (本包合计 16/16)。

具体命令与逐字输出见 `report_path` 处的完整报告。

## 遗留

与原始 cell 报告的 `integration_needs` 相同:`tsconfig.base.json` 的路径条目、 `packages/bundle/base` 与 `packages/bundle/web-app` 新增依赖所需的 `pnpm-lock.yaml` 刷新、 将 `ctx.modelRouter.resolve('specialist')` 接入真正的 `tool-subagent` 派生路径与 SaturnBot, 以及 `saturn-model-router` 的 `settings.plugin.item` 客户端卡片(F3),均仍待完成,归属其他 cell。
