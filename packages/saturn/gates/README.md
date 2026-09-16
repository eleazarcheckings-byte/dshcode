---
description: "The Gates: a policy layer on the tool waterfall that stops credential, money, publish, outbound, identity and irreversible calls and routes them to the user."
kind: "package-reference"
---

# @saturnai/dsh-gates

English | [中文](README.zh.md)

## Summary

`@saturnai/dsh-gates` is what lets a session run with full file and shell access without the dangerous acts riding along. Before any tool runs, the plugin classifies the call against a policy of six consequence classes — credentials, spend, publish, outbound, identity, destructive — and returns `ask` (the user decides) or `deny` (nobody decides; it does not happen here) with a sentence the model reads. Everything the policy does not claim is delegated to the rest of the waterfall untouched, so `ls`, `read`, and a memory lookup cost nothing. The policy is data: shipped rules plus a deployment's own, dropped by id or replaced outright through config, never a branch per tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in any deployment that hands an agent real capability. It injects `tools`, reads `approval` opportunistically through `ctx.get`, and needs no configuration to be useful — the shipped policy is the whole default.

```yaml
- id: gates
  name: '@saturnai/dsh-gates'
```

**Mount it ahead of the Claude Code hook bridge** (`@deepseek-ai/dsh-hooks-claude-code`) and ahead of any other `tools/pre-execute` listener that can ask or deny. Listeners run in mount order, a claimed call is answered without delegating, and an unclaimed call is delegated — so gates-first means the Gate's own classes are decided once, by one policy, and everything else still reaches the bridge.

**Pair it with an approval policy that can say yes.** A deployment whose approval policy is `never` answers every approval with a rejection, so a Gate-class call would hard-deny instead of reaching anyone. The plugin detects that before asking and denies with a reason naming the fix — switch `permission.defaultPreset` to a preset that pairs full file access with `approval: ask` — but the fix belongs in the deployment, not in the model's next turn.

### The six classes

| Class | What it means | Shipped examples |
|---|---|---|
| `credentials` | A secret is read, exported, or established | `mcp__*__keychain_*`, `mcp__*__login`, `mcp__*__cookies`, `gh auth login`, `cat .env`, `export STRIPE_SECRET_KEY=…` |
| `spend` | Money moves, or a metered API is billed | `mcp__shop-ops__create_invoice`, `mcp__shop-ops__update_price`, `mcp__gemini-media__generate_video`, `mcp__*__buy_*`, `stripe … create` |
| `publish` | Something becomes the live thing other people receive | `mcp__shop-ops__deploy_store`, `mcp__saturndesign__propose`, `mcp__*__deploy_*`, `git push --force`, `vercel … --prod`, `wrangler pages deploy`, `gh release create`, `npm publish`, `ship.mjs` |
| `outbound` | A message reaches a real person | `mcp__telegram-hive__send_approved`, `mcp__telegram-hive__schedule`, `mcp__*__send_message`, `mcp__*__reply`, `mcp__*__tiktok_publish`, a `curl` POST to a Slack/Discord/Telegram/SendGrid endpoint |
| `identity` | A domain or DNS record the operator is known by changes | `mcp__*__buy_domain`, `namecheap …`, `wrangler dns`, `vercel domains buy` |
| `destructive` | The effect cannot be undone | `rm -rf` outside the workspace, `Remove-Item -Recurse -Force`, `git reset --hard`, `git clean -fdx`, `DROP TABLE` |

Four rules are `deny` rather than `ask`, because no in-session approval should be able to buy them: a fork bomb, a recursive delete of the filesystem root or the home directory, a disk format, and a raw write to a block device. Everything else asks. Those four are also the rules `allow` cannot reach: a tool-name exemption buys quieter `ask` prompts and never a disarmed fork bomb.

### The two rule shapes

An **MCP rule** matches a tool NAME, because an MCP tool's name already states its effect — `keychain_get` reads a secret whatever its arguments say. The shipped names are the ones the operator's own servers register (telegram-hive, shop-ops, gemini-media, saturn-browser, saturndesign), each paired with a `mcp__*__…` wildcard so the same effect is caught on a server the list has never seen. Names outside both are not gated: `mcp__awake__recall` and `mcp__saturndesign__compose` pass through, and so does a Gate-class tool on a server nobody listed (see Known Limitations).

A **shell rule** additionally matches a regular expression against the call's command text, so one `bash` tool carries both `ls` and a force push. Shell rules are scoped to the tools that actually run a command line (`bash`, `pwsh`, `terminal_send`, and the MCP shell tools), and they read only the argument fields that hold one (`command`, `script`, `text`, `input`, `expression`) — a `write` whose content quotes a force push is still just a write.

### Configuration

| Field | Default | What it does |
|---|---|---|
| `includeDefaults` | `true` | Keep the shipped rules. `false` leaves only `rules`. |
| `rules` | `[]` | Rules appended after the shipped ones, matched in order. |
| `disableRules` | `[]` | Ids of shipped rules to drop. An id that names no shipped rule fails the load. |
| `allow` | `[]` | Tool-name patterns exempt from the `ask` rules. The four `deny` rules stay armed for an exempt tool. |
| `commandFields` | `command`, `script`, `text`, `input`, `expression` | Argument fields a shell rule reads. |
| `deferToSandboxEscalation` | `true` | Abstain on a call that already carries its own escalation (see below). `false` trades a second question for a prompt that names the class. |
| `escalationTools` | `bash`, `pwsh` | The tools whose body resolves an escalation approval of its own. |
| `escalationModes` | `workspace-write`, `danger-full-access` | The modes an escalation may name for that abstention to apply. A mode outside this list never reaches a human, so it does not excuse a Gate-class call. |

One rule is `{ id, class, action?, tools, pattern?, reason }`. `tools` entries are wildcard patterns where `*` matches any run of characters and everything else is literal; `pattern` is a case-insensitive regular expression; `reason` is the sentence the model reads. A policy that cannot be compiled — an unknown class, a duplicate id, an empty tool list, an empty reason, an uncompilable pattern — fails the plugin load rather than gating nothing.

## Understand the implementation

`types.ts` holds the vocabulary. `roster.ts` is the shipped policy, ordered: the four `deny` rules first, then credentials, identity, spend, publish, outbound, and destructive asks — identity sits ahead of spend so buying a domain reads as an identity act rather than a generic purchase. `policy.ts` compiles that data once per load (anchored tool matchers, case-insensitive patterns, fail-loud validation) and classifies one call at a time as a pure function, which is why the whole roster can be pinned by table. `index.ts` is the only part that touches the runtime: one `tools/pre-execute` listener.

Three composition rules that listener keeps, all load-bearing:

1. **An unclaimed call is delegated** with `next()`. The Gate narrows nothing it does not claim.
2. **A claimed call is answered without delegating.** It is already going to a human; letting a later listener raise a second decision for the same call would put two questions in front of the user for one action.
3. **A shell call that already carries a `sandbox_permissions` escalation is delegated even when an `ask` rule claims it**, because that call's own body resolves one approval through the same seam before it executes anything. Abstaining keeps the count at one question, and nothing runs unapproved either way: an escalating call that is refused, unanswerable, or agent-less fails before the command runs. Three things bound the abstention. A `deny` class is decided first, so an escalation can never buy a pass. The mode must be one of `escalationModes` — a request naming anything else is refused by the sandbox's own widening check without a human seeing it, so honouring it would let two invented arguments silence any `ask` rule. And the abstention is logged with the class and rule id, because it is the one path where the Gate claims a call and puts nothing of its own in front of the human — see Known Limitations.

The plugin never calls `ctx.approval` itself. It returns `{ kind: 'ask' }` and the tool registry resolves it through the approval seam, which is what keeps one call to one question and puts the ask/decision pair in the session's own audit log. The one thing it reads from that seam is the effective policy — the session's override, else the deployment default — because an ask under `never` is answered `rejected` without anyone seeing it, and the model would otherwise report a refusal the user never made.

## Model Experience

### The reason on a stopped call

#### What the model sees

Nothing at all until a call is claimed: an unclaimed call carries no added text, no schema, and no prompt section. A claimed call comes back as one sentence built from the rule that claimed it — `Gate: <class> — <the rule's sentence> (rule <id>)` — followed by what happens now. An `ask` adds that the user decides this one before it runs. A `deny` adds that it is not available from inside a session and that the user runs it themselves if they want it. The two closed paths say which one happened: with no approval seam composed, that this session has no approval channel; with approval prompts disabled, that the `danger-full-access` preset rejects every request automatically and that `permission.defaultPreset` should be switched to `full-access-gated`. A rejected `ask` is reported by the tool registry in its own words, not this plugin's.

#### Token effect

Zero for every call the policy does not claim, which is nearly all of them. A claimed call adds one sentence of roughly 40–70 tokens to that call's result. No system-prompt section and no tool schema are contributed, so the cost is strictly per stopped call.

#### KV Cache effect

Independent: the text rides one tool result and never rewrites an earlier request. The plugin adds nothing to the prompt prefix, so mounting, unmounting, or re-configuring the policy between turns cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

- **A shell rule reads command text with a regular expression.** It matches what the command says, not what it does: a Gate-class command assembled at runtime, base64-decoded, read from a file, or reached through a script this policy has never heard of is not classified. The shipped patterns are a catastrophe net for the commands an agent actually writes, not a sandbox.
- **There is no network egress control anywhere in the harness**, and this package does not add one. The outbound rules name specific endpoints in a command line; a POST to an endpoint nobody listed, or from inside a program rather than a shell, is not seen. Egress control belongs to a layer that can observe the socket.
- **An unknown MCP server passes through unless it is listed.** The wildcards catch the common effect names (`keychain_*`, `buy_*`, `deploy_*`, `publish_*`, `send_message`), but a Gate-class tool with a name nobody anticipated is not gated until someone adds a rule for it. Mounting a new server is therefore a policy event, not just a config one.
- **A Gate-class shell call that carries its own sandbox escalation is approved through the sandbox's question, not the Gate's.** The single prompt reads `escalate sandbox to <mode>: <the model's own justification>`; the class, the rule id and the rule's sentence do not appear in it, so the human is consenting to a sandbox change while the gated act rides along. Nothing runs unapproved — a refusal still stops the command — but the consent is less informed than on every other path. The escalation must name a real mode from `escalationModes`, which stops an invented one from suppressing the Gate; a genuine escalation still hides the class. The remedy is `deferToSandboxEscalation: false`, which puts the Gate's own class-naming question back in front of the human at the cost of a second prompt for that one call. Closing the gap without that trade needs the escalating tool to carry a caller-supplied reason into its approval request, which is a change in `@deepseek-ai/dsh-tool-bash`, not here.
- **The classes are about consequence, not intent.** `mcp__telegram-hive__stage` is deliberately NOT gated: staging writes a draft to an outbox that a human still has to approve, and the tool that actually sends — `send_approved` — is gated. A deployment that treats staging as outbound adds a rule for it.
- **Nothing here reaches the deployment's preset.** The plugin can detect that approval prompts are disabled and say so, but it cannot switch `permission.defaultPreset` itself; until that switch happens, every Gate-class call denies instead of asking.

### Dev Note

The [Gate policy note](../../../.agents/notes/implemented/feature/2026-09-16-saturn-gates.md) records why the policy is data rather than branches, why a claimed call does not delegate, and why a call carrying its own sandbox escalation is left alone. No runtime invariant installer is published: the relation this package owns is a decision per call, and the composition suite exercises it through the real tool registry and the real approval service rather than through a companion observation.
