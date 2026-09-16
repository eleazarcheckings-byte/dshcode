# Agent Note: 提交的约定式类型必须与其暂存内容相符

Status: implemented

[English](2026-09-16-commit-type-scope-gate.md) | 中文

## 问题

测试先行的审计链依赖提交类型。审阅者或 Mars 会把 `test(` 提交列为 RED 半程、把 `feat(`/`fix(` 提交列为 green 半程，而 `docs(`/`chore(` 提交会被当作纯文档跳过。2026-09-15 的提交 `78a06d26b1` 主题写着 `docs(saturn): re-record translation-pairing sidecars for hygiene-docs READMEs`，实际却携带了整个 `packages/saturn/tool-media` 实现（18 个文件，七个全新的 `src/` 模块），外加一份已提交 RED 规格的六行改动。`git log --all` 中没有任何 tool-media 的 `feat(` 提交，因此 RED/GREEN 审计会把该特性读成从未实现，1.2.2 的独立评审据此记为 should-fix。仓库里没有任何机制在错标发生的那一刻拦住它。

## 决定

lefthook 的 `commit-msg` 任务以 git 传入的消息文件运行 `scripts/verify-commit-scope.ts`。规则位于 `scripts/commit-scope.ts`，该模块不读取仓库，因此可以用夹具驱动：

- `docs()` 提交只有在其零上下文 diff 的每一行增删都是注释或空行时，才可以暂存 `src/` 或 `tests/` 下的文件。JSDoc 补全提交仍然用 `docs(`；`docs(` 主题下的代码改动会被拒绝。
- `chore()` 提交不得暂存 `src/` 或 `tests/` 下的任何脚本或 TypeScript 文件。清单、锁文件、配置、生成的目录、声明与笔记仍然属于 chore。
- `feat`、`fix`、`test`、`build` 以及无类型主题（合并、回滚、自由文本）不做判定。
- `Scope-Exception: <原因>` 尾注可豁免违规；钩子在成功时打印该原因，尾注保留在消息中，任何后续审计都能看到这次豁免。空原因不构成豁免。

钩子会在 stderr 上逐条列出违规路径并以 1 退出。安装沿用现有的 `node scripts/install-lefthook.mjs` 路径；`lefthook install --force` 会依据 `lefthook.yml` 重新生成 worktree 本地钩子，因此每个重新安装的 worktree 都会得到该任务。

## 备选方案

**commitlint 或其他消息检查器。** 否决：只看消息的检查器看不到暂存的 diff，而缺陷恰恰是消息与 diff 不一致。它还会为一条规则引入一个依赖。

**在 `docs(` 下拦截所有 `src/` 改动。** 否决：master 最近六十个提交中有三个是 JSDoc 补全，它们只改源码文件中的注释行，且正确地标为 `docs(`。拒绝它们会把真正的文档工作推向 `fix(`，让审计链更不诚实。

**用 `pre-commit` 任务代替 `commit-msg`。** 否决：在消息存在之前无法得知类型。`commit-msg` 是第一个同时看到消息与暂存索引的钩子。

**只做 CI 侧的历史审计。** 作为唯一防线被否决：它在错标已经进入 master、无法再改写历史之后才发现问题。提交时的钩子是廉价的第一道防线；历史审计以后仍可补上。

## 后果

错标提交的作者会在本地被拒绝，并看到路径和两种补救方式。`Scope-Exception:` 尾注是逃生口，而且刻意做得显眼：原因在提交时打印，并留在 `git log` 中。`git commit --no-verify` 仍可绕过该钩子，正如它能绕过所有本地钩子；仓库对此的立场不变。该闸门不追溯，也不会重新标注既有提交；`78a06d26b1` 改在 tool-media 的 Agent Note 中披露。

验证：`node_modules/.bin/vitest run scripts/commit-scope.spec.ts` 覆盖头部解析、尾注、路径与纯注释分类器、各提交类型的判定，以及在临时 git 仓库中的端到端 CLI（`chore(` 暂存源码时以 1 退出并点名路径，`feat(` 以 0 退出，`Scope-Exception:` 打印豁免，用法错误以 2 退出）。规格在实现之前以 RED 状态提交。
