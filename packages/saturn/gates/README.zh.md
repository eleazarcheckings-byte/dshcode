---
description: "The Gates：工具瀑布流上的策略层，拦下凭据、金钱、发布、对外、身份与不可逆的调用，并把它们交回给用户。"
kind: "package-reference"
---

# @saturnai/dsh-gates

[English](README.md) | 中文

## 概述

`@saturnai/dsh-gates` 是让一个 session 拥有完整文件与 shell 权限、同时不让危险动作顺势搭车的那一层。任何工具运行之前，插件都会按六个后果类别对该调用分类——凭据、花钱、发布、对外、身份、破坏性——并返回 `ask`（由用户决定）或 `deny`（无人可决定，它在这里不会发生），附上一句给模型读的说明。策略没有认领的调用会原样交给瀑布流上的其余监听器，因此 `ls`、`read` 和一次记忆查询不产生任何开销。策略是数据：内置规则加上部署方自己的规则，可按 id 删除或整体替换，而不是给每个工具写一条分支。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

任何把真实能力交给 agent 的部署都应挂载它。它注入 `tools`，通过 `ctx.get` 择机读取 `approval`，无需任何配置就能生效——内置策略就是全部默认值。

```yaml
- id: gates
  name: '@saturnai/dsh-gates'
```

**把它挂在 Claude Code hook 桥接（`@deepseek-ai/dsh-hooks-claude-code`）之前**，也排在任何其他可能发出询问或拒绝的 `tools/pre-execute` 监听器之前。监听器按挂载顺序运行，被认领的调用不会继续下传，未被认领的调用则会下传——所以 gates 在前意味着 Gate 自己的类别由一份策略决定一次，其余一切仍然会到达桥接层。

**同时配一个真的能说"是"的审批策略。** 如果部署的审批策略是 `never`，每一次审批请求都会被自动拒绝，Gate 类调用就会硬拒绝而不是抵达任何人。插件在询问之前就会识别这种情况，并给出点名修复方式的拒绝理由——把 `permission.defaultPreset` 换成一个既有完整文件访问、审批又是 `ask` 的预设——但这个修复属于部署层，而不是模型的下一轮。

### 六个类别

| 类别 | 含义 | 内置示例 |
|---|---|---|
| `credentials` | 读取、导出或建立一个秘密 | `mcp__*__keychain_*`、`mcp__*__login`、`mcp__*__cookies`、`gh auth login`、`cat .env`、`export STRIPE_SECRET_KEY=…` |
| `spend` | 有钱流动，或计费 API 被调用 | `mcp__shop-ops__create_invoice`、`mcp__shop-ops__update_price`、`mcp__gemini-media__generate_video`、`mcp__*__buy_*`、`stripe … create` |
| `publish` | 某样东西成为别人会收到的线上版本 | `mcp__shop-ops__deploy_store`、`mcp__saturndesign__propose`、`mcp__*__deploy_*`、`git push --force`、`vercel … --prod`、`wrangler pages deploy`、`gh release create`、`npm publish`、`ship.mjs` |
| `outbound` | 一条消息会抵达真实的人 | `mcp__telegram-hive__send_approved`、`mcp__telegram-hive__schedule`、`mcp__*__send_message`、`mcp__*__reply`、`mcp__*__tiktok_publish`，以及 `curl` 向 Slack/Discord/Telegram/SendGrid 端点的 POST |
| `identity` | 操作者赖以被识别的域名或 DNS 记录发生变化 | `mcp__*__buy_domain`、`namecheap …`、`wrangler dns`、`vercel domains buy` |
| `destructive` | 后果无法撤销 | workspace 之外的 `rm -rf`、`Remove-Item -Recurse -Force`、`git reset --hard`、`git clean -fdx`、`DROP TABLE` |

有四条规则是 `deny` 而非 `ask`，因为它们不应该能被 session 内部的任何审批买下来：fork bomb、递归删除文件系统根目录或整个 home 目录、格式化磁盘、以及直接写入块设备。其余一律询问。这四条同时也是 `allow` 够不到的规则：工具名豁免买到的是更安静的 `ask` 提示，永远不是一枚被解除武装的 fork bomb。

### 两种规则形态

**MCP 规则**匹配工具的名字，因为 MCP 工具的名字本身就说明了它的后果——无论参数写什么，`keychain_get` 都在读一个秘密。内置的名字来自操作者自己的服务器（telegram-hive、shop-ops、gemini-media、saturn-browser、saturndesign），每一条都配了 `mcp__*__…` 通配，以便在这份清单从未见过的服务器上也能抓到同样的后果。两者之外的名字不设门：`mcp__awake__recall` 与 `mcp__saturndesign__compose` 直接通过，未被任何人列入的服务器上的 Gate 类工具同样通过（见"已知限制"）。

**Shell 规则**还要用正则匹配调用的命令文本，所以同一个 `bash` 工具既承载 `ls` 也承载强制推送。Shell 规则只限定在真正会执行命令行的工具上（`bash`、`pwsh`、`terminal_send` 以及 MCP 的 shell 工具），并且只读取真正装着命令行的参数字段（`command`、`script`、`text`、`input`、`expression`）——一个内容里引用了强制推送的 `write`，仍然只是一次写入。

### 配置

| 字段 | 默认值 | 作用 |
|---|---|---|
| `includeDefaults` | `true` | 保留内置规则。设为 `false` 则只剩 `rules`。 |
| `rules` | `[]` | 追加在内置规则之后的规则，按顺序匹配。 |
| `disableRules` | `[]` | 要删除的内置规则 id。指向不存在的内置规则时加载失败。 |
| `allow` | `[]` | 豁免 `ask` 规则的工具名模式。对被豁免的工具，四条 `deny` 规则依旧生效。 |
| `commandFields` | `command`、`script`、`text`、`input`、`expression` | shell 规则读取的参数字段。 |
| `deferToSandboxEscalation` | `true` | 对已自带升级请求的调用弃权（见下文）。`false` 用多问一次的代价，换一个点名类别的提示。 |
| `escalationTools` | `bash`、`pwsh` | 自身会解析一次升级审批的工具。 |
| `escalationModes` | `workspace-write`、`danger-full-access` | 升级请求必须点名的模式，弃权才成立。不在此列的模式根本到不了人面前，因此它不能为一次 Gate 类调用开脱。 |

一条规则是 `{ id, class, action?, tools, pattern?, reason }`。`tools` 条目是通配模式，其中 `*` 匹配任意长度的字符，其余一切按字面匹配；`pattern` 是大小写不敏感的正则；`reason` 是模型读到的那句话。无法编译的策略——未知类别、重复 id、空工具列表、空理由、无法编译的正则——会让插件加载失败，而不是静默地什么都不拦。

<a id="understand-the-implementation"></a>
## 理解实现

`types.ts` 承载词汇。`roster.ts` 是内置策略，且有序：四条 `deny` 规则在前，随后是凭据、身份、花钱、发布、对外，以及破坏性的询问规则——身份排在花钱之前，这样"买一个域名"读起来是身份行为而不是一次普通采购。`policy.ts` 在每次加载时把这些数据编译一次（锚定的工具名匹配器、大小写不敏感的正则、加载即失败的校验），并以纯函数的方式逐个调用分类，这正是整份内置策略能被逐条表格化钉住的原因。`index.ts` 是唯一触碰运行时的部分：一个 `tools/pre-execute` 监听器。

该监听器坚持三条组合规则，每一条都承重：

1. **未被认领的调用会被 `next()` 下传。** Gate 绝不收窄它没有认领的东西。
2. **被认领的调用就地作答，不再下传。** 它已经在去往人类的路上；让后面的监听器为同一次调用再作一次决定，就等于为一个动作把两个问题摆到用户面前。
3. **已经自带 `sandbox_permissions` 升级请求的 shell 调用，即便被 `ask` 规则认领也照样下传**，因为那次调用自己的函数体会在执行任何东西之前，经由同一个 seam 解析一次审批。弃权把问题数量保持在一个，而且两种路径都不会让未经批准的东西运行：一次被拒绝、无人可答或没有 agent 的升级请求，会在命令运行之前就失败。三件事框住了这次弃权。`deny` 类别在这一步之前就已判定，所以升级请求永远换不来放行。模式必须是 `escalationModes` 里的一个——点名其他任何模式的请求，都会被沙箱自己的加宽校验挡下、人根本看不到，若照单全收，两个凭空捏造的参数就能让任何 `ask` 规则噤声。而这次弃权会带着类别与规则 id 写进日志，因为这是唯一一条 Gate 认领了调用、却没有把自己的任何东西摆到人面前的路径——见"已知限制"。

插件自己从不调用 `ctx.approval`。它返回 `{ kind: 'ask' }`，由工具注册表经审批 seam 解析——这既让一次调用只对应一个问题，也把"询问/决定"这一对审计事件留在 session 自己的日志里。它从那个 seam 读取的唯一一件事是生效中的策略——session 自己的覆盖值，否则是部署默认值——因为 `never` 之下的询问会在无人看见的情况下被答成 `rejected`，模型于是会报告一个用户从未做出的拒绝。

<a id="model-experience"></a>
## 模型体验

### 被拦下的调用所附的理由

#### 模型看到什么

在调用被认领之前，模型什么都看不到：未被认领的调用不会附加任何文本、schema 或提示词段落。被认领的调用会带回一句由认领它的规则拼成的话——`Gate: <类别> — <该规则的句子> (rule <id>)`——后面跟着接下来会发生什么。`ask` 会补充说明这一次由用户来决定是否运行。`deny` 会补充说明它在 session 内部不可用，用户若想要就自己去运行。两条关闭的路径会说明发生的是哪一种：没有挂载审批 seam 时，说明本 session 没有审批通道；审批提示被关闭时，说明 `danger-full-access` 预设会自动拒绝每一次请求，并且应当把 `permission.defaultPreset` 换成 `full-access-gated`。被拒绝的 `ask` 由工具注册表用它自己的措辞报告，而不是本插件的。

#### Token 影响

策略未认领的调用为零，而这几乎是全部调用。被认领的调用会给那一次调用的结果增加大约 40–70 token 的一句话。本包不贡献任何系统提示词段落，也不贡献任何工具 schema，因此开销严格地只按"被拦下的调用"计。

#### KV 缓存影响

独立：这段文本搭乘一次工具结果，绝不改写更早的请求。插件不向提示词前缀添加任何东西，所以在两轮之间挂载、卸载或重新配置策略，都不会让已缓存的前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **shell 规则用正则读取命令文本。** 它匹配的是命令怎么写，而不是命令会做什么：运行时拼装、base64 解码、从文件读入，或经由这份策略从未听说过的脚本达成的 Gate 类命令，都不会被分类。内置的模式是为 agent 真会写出来的命令准备的一张灾难防护网，而不是沙箱。
- **整个 harness 里没有任何出网管控**，本包也不添加。对外规则点名的是命令行里的具体端点；发往无人列出的端点、或从程序内部而非 shell 发出的 POST，都看不见。出网管控属于能观察 socket 的那一层。
- **未知的 MCP 服务器在未被列入之前一律通过。** 通配能抓住常见的后果名（`keychain_*`、`buy_*`、`deploy_*`、`publish_*`、`send_message`），但名字无人预料到的 Gate 类工具，在有人为它加一条规则之前不会被设门。因此挂载一个新服务器是一次策略事件，而不只是一次配置改动。
- **自带沙箱升级请求的 Gate 类 shell 调用，是经由沙箱的问题、而不是 Gate 的问题获得批准的。** 那唯一一次提示写的是 `escalate sandbox to <模式>：<模型自己写的理由>`；类别、规则 id 与规则的那句话都不会出现在里面，于是人同意的是一次沙箱变更，被设门的动作顺势搭车。没有任何东西会未经批准运行——拒绝依旧会拦住命令——但这份同意不如其他任何路径上的知情。升级请求必须点名 `escalationModes` 里的真实模式，这挡住了用捏造模式压掉 Gate 的做法；而一次真实的升级请求，依旧会把类别藏起来。补救办法是 `deferToSandboxEscalation: false`，用这一次调用多问一次的代价，把 Gate 自己那句点名类别的问题重新摆到人面前。不付这个代价而把缺口补上，需要让发起升级的工具把调用方给出的理由带进它的审批请求里，那是 `@deepseek-ai/dsh-tool-bash` 的改动，不在本包。
- **类别关乎后果，而非意图。** `mcp__telegram-hive__stage` 被刻意排除在外：staging 只是把草稿写进一个仍需人类批准的 outbox，而真正发送的那个工具——`send_approved`——是设了门的。若某个部署认为 staging 也算对外，自行为它加一条规则。
- **本包够不到部署的预设。** 插件能识别出审批提示已被关闭并把话说清楚，却无法自己切换 `permission.defaultPreset`；在那个切换发生之前，每一次 Gate 类调用都会拒绝而不是询问。

<a id="dev-note"></a>
### 开发备注

[Gate 策略笔记](../../../.agents/notes/implemented/feature/2026-09-16-saturn-gates.zh.md)记录了策略为何是数据而不是分支、被认领的调用为何不下传，以及自带 sandbox 升级请求的调用为何被放行给它自己。本包不发布运行时 invariant 安装器：它拥有的关系是"每次调用一个决定"，而组合测试是通过真实的工具注册表与真实的审批服务来检验它的，而不是通过一个 companion 观察。
