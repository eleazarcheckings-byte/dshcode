# Agent Note:model-router —— Mars r2 修复(codex 的解析结果被反了;包装包依赖声明已恢复)

状态:已实现

[English](2026-09-15-model-router-mars-r2-fixes.md) | 中文

## 问题

Mars 对 C6 的第二次评审(`.../scratchpad/review/C6-model-router-providers-r2.md`)给出了 REVISE。核心发现 (F1-r2):r1 修复中 `harnessCliResolvable` 的第二阶段用单一的裸说明符 `require.resolve(cliPackage)` 来解析 某个原生工具的 CLI 依赖。该调用对 `@openai/codex` 永远失败——它是一个仅含 `bin` 的包 (`{ bin: { codex: ... } }`,没有 `main`,没有 `exports`),裸说明符没有任何可作为该包主模块加载的目标, Node 会抛出 `MODULE_NOT_FOUND`。于是即便 `@openai/codex` 确实已安装在 `dsh-subagent-codex` 自身的 `node_modules` 中,`harnessAvailable('codex')` 仍报告 `false`——这与 SPEC §3 C6(3) 的要求正好相反:该行如今 在 CLI *存在* 时自我隐藏,而不是在其缺失时。`claude-code` 未受影响纯属巧合:`@anthropic-ai/claude-agent-sdk` 恰好声明了一个真实的 `.` 导出,裸说明符可以借此解析成功。次要发现(F2-r2):r1 的修复把 `@deepseek-ai/dsh-subagent-codex` / `-claude-code` 从 `optionalDependencies` 移除,只留在 `devDependencies` 里——第一阶段的解析(锚定在 `model-router` 自身模块上)因此依赖于一条未声明的边,而生产环 境的裁剪安装不会保留这条边。

## 决定

- **第二阶段现在会尝试两种说明符形式。** `harnessCliResolvable(resolver, subagentPackage, cliPackage, createRequireFn)` 用一个锚定在包装包清单上的 `require` 去解析 `cliPackage`——既尝试裸形式,也尝试 `${cliPackage}/package.json` 形式,任一成功即可。本轮已针对真实安装的清单验证:`@openai/codex`(没有 `main`/`exports`)只能通过 `/package.json` 解析;`@anthropic-ai/claude-agent-sdk`(其 `exports` 映射含 `.` 但不含 `./package.json`)只能通过裸说明符解析,子路径会抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED`。同时尝试 两种形式回答的是“该 CLI 依赖是否存在”这一问题本身,而不必为每个原生工具硬编码一种说明符形状——相比之下,若 在 `HARNESS_CLI_PACKAGE` 表中为每一行预先指定一种形式,一旦未来某个被包装的 CLI 换成另一种清单形状,就会 在无声无息中再次失效。
- **恢复了 `optionalDependencies`。** `@deepseek-ai/dsh-subagent-codex` 与 `@deepseek-ai/dsh-subagent-claude-code` 从 `devDependencies` 移回 `@saturnai/dsh-model-router` 的 `optionalDependencies`——这才是准确的声明:本包 自身代码会在运行时解析这两个依赖,但也能容忍它们缺失。README(及中文版)记录了本轮从已打包桌面应用的 `resources/app/node_modules` 中只读检查所得的证据:那是单一的扁平目录(electron-builder 的打包方式,而非 pnpm 的隔离式逐包存储),因此 `optionalDependencies` 对 `pnpm install` 以及未来任何隔离式安装打包路径而言 仍是正确声明,只是在当前应用所用的扁平布局下,它并非阻止第一阶段出现假阴性的唯一因素——检查时该目录下并 未出现这两个包装包,因此打包后、开关打开的场景仍未经端到端观测。
- **修正了 README/README.zh。** 此前声称第二阶段使用“与 Node 自身从包装包内部加载该 CLI 时所用的解析顺序一 致”,这句话对 `codex` 并不成立(裸说明符根本不是通向其 `bin` 入口点的方式)——已替换为对实际双形式探测的描 述,以及每个原生工具各自需要哪种形式的原因。已用 `pnpm run verify-translation-pairing --write` 重新记录。
- **新增测试文件,而非编辑已提交的 RED 文件。** `tests/harness-cli-resolution.spec.ts`(Mars r1 的 RED 提 交)未被改动;本轮修复说明中提到一个由已停止的重复代理写下的、约 45 行的未提交增补内容,但本轮开始时该文件 已经干净、与 `HEAD` 完全一致(`git status` 与 `git diff HEAD` 均为空;没有 stash,reflog 中也没有相应记 录)——这段增补内容已经不在了,最可能是被本会话共享上下文中提到的、某个兄弟代理两次执行的仓库级未提交改动 清除操作一并清掉了。没有据此臆测重建,而是从头新写了一个文件 `tests/harness-cli-resolution-real-env.spec.ts`,表达 Mars r2 所要求的真实环境、无 fake 用例,先针对修 复前的代码提交为 RED(codex 用例失败;已确认),再在修复后保留下来。

## 与修复清单的偏差(已声明,非隐瞒)

- **选择了“两种形式都尝试”,而非“`HARNESS_CLI_PACKAGE` 每行各配一种形式”**——修复说明中两者皆可选。按行配置 形式能更明确地说明每个原生工具“为什么”是那样解析的,但会把正确性绑定在一张需要有人记得随时更新的表上;同 时尝试两种形式则是自我纠正的,代价至多是每个原生工具每个进程多一次同步的 `require.resolve` 调用(首次探 测后即被缓存,与此前一致)。
- **未“恢复”那段散落的测试增补**——磁盘上本就没有可恢复的内容(见上文“决定”);按照修复说明的回退分支,改为 新写了一个 RED 文件。

## 考虑过的替代方案

**在 `harnessCliResolvable` 中为 `codex` 特判一个 `if (harness === 'codex') 使用 '/package.json'` 分支。** 被否决:该函数把 `cliPackage` 当作不透明字符串来接收,正是为了不需要知道自己在探测哪个原生工具;按原生工具 特判会把这层知识重新泄漏回来,而且仍无法覆盖未来某个拥有自己清单形状的第三个原生工具。

**放弃 `/package.json` 子路径探测,改为直接根据目标包自身声明的 `bin` 字段解析 `${cliPackage}/bin/codex.js`(或类似路径)。** 被否决:这需要先读取并解析目标包自身的 `package.json` 来 按原生工具找到 `bin` 路径——而这正是 `packageResolvable` 的 `require.resolve` 已经通用完成的文件系统读 取;而且每个原生工具各自的 `bin` 布局都需要一条不同的字面路径,比尝试两种固定的、与原生工具无关的形式更差。

## 结果

**代价:** `harnessCliResolvable` 的第二阶段检查现在最多进行两次 `require.resolve` 调用,而非一次(仍由 `harnessAvailable` 按进程缓存,因此额外开销至多是每个原生工具每个进程生命周期一次)。公开 API 与构造函数签 名均未改变。

**收获:** 本检出中 `harnessAvailable('codex')` 现在报告 `true`(已确认:19/19 测试通过,包括新增的真实环境 文件),这才符合 SPEC §3 C6(3) 的真实意图——开关打开且 CLI 确实已安装时该行会挂载,而在两种已发布的原生工 具上,CLI 确实缺失时仍会继续自我隐藏。

## 测试

新增:`tests/harness-cli-resolution-real-env.spec.ts`(3 个测试,无 fake——用真实的 `createRequire` 针对 `@openai/codex` 与 `@anthropic-ai/claude-agent-sdk` 的真实安装清单)。先确认了 RED,并单独提交 (`test(saturn): RED -- real-environment coverage for Mars r2 F1-r2`):codex 用例在修复前的单形式解析下失 败(`expected false to be true`);claude-code 用例与否定用例在修复前就已通过(已在 RED 提交信息中说明这是 预期情况,而非疏漏)。随后实现了双形式的第二阶段探测;新增的 3 个测试与包内既有的 16 个测试全部通过 (19/19)。`node_modules/.bin/tsc -p packages/saturn/model-router/tsconfig.json --noEmit` 干净无输出。 `node_modules/.bin/vitest run packages/saturn/model-router packages/bundle/base` —— 全部通过(逐字的计数 与命令输出见 report_path)。

## 遗留

与 r1 说明保持一致:`tsconfig.base.json` 的路径条目、`packages/bundle/base` / `packages/bundle/web-app` 依 赖项所需的 `pnpm-lock.yaml` 刷新(本轮恢复 `optionalDependencies` 也计入这一待处理刷新)、把 `ctx.modelRouter.resolve('specialist')` 接入真实的 `tool-subagent` 派生路径与 SaturnBot,以及 `saturn-model-router` 的 `settings.plugin.item` 客户端卡片。
