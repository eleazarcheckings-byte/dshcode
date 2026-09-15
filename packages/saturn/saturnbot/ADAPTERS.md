# SaturnBot adapter reference

English | [中文](ADAPTERS.zh.md)

The [runtime](README.md) admits these 19 typed tools through global and per-role allowlists. An adapter declaration supplies its role ceiling, effect, input schema, and retry policy; model arguments cannot override them. `createBotTools` requires a Host-owned data directory and the managed subprocess service. Tests inject HTTP responses while exercising real Git, files, process trees, and SQLite.

## Local tools and isolation

| Tools | Operation |
| --- | --- |
| `git.status`, `git.diff`, `fs.read` | Read repository state or bounded UTF-8 source files. |
| `workspace.stage` | Create or recover a task-specific detached worktree from committed HEAD. |
| `fs.write` | Atomically replace one staged file and commit its exact revision. |
| `shell.validate` | Run the exact executable/argument arrays in `validationCommands`. |
| `memory.search`, `memory.write` | Query literal text or upsert a persistent memory entry. |
| `tickets.list`, `tickets.upsert` | Read or update local support tickets with explicit status. |
| `webhook.inbox` | Read authenticated, deduplicated webhook receipts. |

File adapters reject traversal, symlink components, Git metadata, common credential directories, environment files, and Windows device/path aliases. Individual reads and writes are limited to 128 KiB; retained strings are capped at 16 KiB with explicit truncation. A worktree excludes uncommitted source-checkout changes. Staged writes create commits; validation and publication verify ownership, the exact commit, and a clean working tree. Empty validation configuration cannot authorize publication. GitHub push and deployment always reference that immutable commit.

Validation uses configured argv arrays without shell interpolation, strips ambient credentials, substitutes an isolated HOME, bounds output, and waits for process-tree cleanup on cancellation or timeout. **A Git worktree is not an operating-system sandbox.** Configured validation can execute project code with the Host account's filesystem and network permissions, including access outside the worktree. Use a separately restricted runtime/host for untrusted repositories. Environment clearing does not prevent code from reading files that the account can access.

Stages persist for inspection and approval recovery; a failed stage creation attempts removal through Git. `fs.write` is not automatically retried after an uncertain commit outcome. Inspect a dirty or externally changed stage and start a fresh task when its recorded revision cannot be recovered. Memory, tickets, and webhook receipts use `knowledge.sqlite` in the Host data directory, with parameterized queries and connections closed after each operation. Memory queries are substring searches, not arbitrary SQL.

## Configure credentials

Integration settings contain environment variable **names**, never credential literals. Supply the referenced variables to the process launching the configured `dsh` profile. Preserve least-privilege provider permissions and configure the intended repository, mailbox, or project. A connection marked `configured` means its settings and credential variable are present; authentication has not been tested. Missing configuration and provider 401/403 responses surface as action required.

```yaml
integrations:
  github:
    credentialEnv: SATURN_GITHUB_TOKEN
    resource: owner/repository
  email:
    credentialEnv: SATURN_GRAPH_TOKEN
    resource: operator@example.com
  stripe:
    credentialEnv: SATURN_STRIPE_KEY
  cloud:
    endpoint: https://deploy.example.com/saturnbot
    credentialEnv: SATURN_DEPLOY_TOKEN
    resource: project-id
  social:
    endpoint: https://social.example.com/saturnbot
    credentialEnv: SATURN_SOCIAL_TOKEN
  creative:
    endpoint: https://creative.example.com/saturnbot
    credentialEnv: SATURN_CREATIVE_TOKEN
  webhook:
    credentialEnv: SATURN_WEBHOOK_SECRET
```

Endpoint overrides must use HTTPS without embedded credentials, queries, or fragments. Redirects are rejected. Remote response bodies are limited to 128 KiB before JSON parsing, then checked against provider response schemas. Retained data redacts configured credential values; transport failures do not retain provider bodies or exception excerpts. Providers may still return private business content, so protect the local data directory and dashboard access.

## Provider operations

| Tools | Provider behavior |
| --- | --- |
| `github.create_pr` | Push the approved commit to a deterministic task branch and create a draft PR; never merge. |
| `email.inbox`, `email.draft`, `email.send` | Read inbox previews, create an unsent draft, or submit the exact approved message. |
| `stripe.metrics` | Read balances and one bounded transaction page, preserving currencies and minor units. |
| `cloud.deploy` | Verify the commit exists on GitHub, then submit its SHA to the configured deployment provider. |
| `social.publish` | Submit approved channel/text to the configured provider. |
| `creative.generate` | Request an image, video, or audio asset and return the provider's actual status and HTTPS links. |

GitHub defaults to `https://api.github.com` and API version `2026-03-10`. The token needs repository contents write and pull requests write for publication. The adapter finds an existing PR only when its task marker and head revision match exactly. Push authentication is supplied only to that Git invocation; hooks, credential helpers, signing, and redirects are disabled. See [GitHub pull requests](https://docs.github.com/en/rest/pulls/pulls).

Email defaults to Microsoft Graph `https://graph.microsoft.com/v1.0`, using `/users/{mailbox}`. Grant mail read for inbox access, mail read/write for draft creation, and mail send for submission; delegated versus application access follows your tenant's authorization policy. `email.send` requires HTTP 202 and reports acceptance, **not confirmed delivery**. Drafts remain unsent. No email mutation is retried after an uncertain network outcome. See [list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0) and [send mail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

Stripe defaults to `https://api.stripe.com/v1`; use a key with balance and balance-transaction read access. The adapter groups charge/payment revenue, refunds, fees, payouts, other outflows, and net movement separately by currency. Integers remain in each currency's minor units. Payouts are not revenue. Totals describe only the returned page; `hasMore` explicitly reports additional transactions. These are account cash movements, not a complete accounting profit calculation. See [balance transactions](https://docs.stripe.com/api/balance_transactions/list).

## Deployment, social, and creative HTTP requests

These integrations require an operator-configured endpoint implementing the following JSON requests; an arbitrary vendor API URL is insufficient. Every request uses POST, `Authorization: Bearer …`, `Content-Type: application/json`, and `Idempotency-Key` equal to `requestId`. Undefined optional `resource` is omitted. The provider owns deduplication and authorization of the selected project or channel.

| Endpoint | Request JSON fields |
| --- | --- |
| Cloud | `resource?`, `repository`, `revision`, `environment`, `requestId` |
| Social | `resource?`, `channel`, `text`, `requestId` |
| Creative | `resource?`, `kind` (`image`, `video`, `audio`), `prompt`, `requestId` |

A successful JSON response contains `id` and `status` (`accepted`, `running`, or `completed`), plus optional HTTPS `url`. Creative responses may include up to 20 `assets`, each with HTTPS `url` and `mimeType`. Large retained asset lists report `omittedAssets`. Asset URLs cannot embed user/password credentials. Asynchronous acceptance remains asynchronous; adapters do not invent completion, poll status, or download assets. Publication, deployment, and creative generation have no automatic retry after an uncertain response. Their approval rules are owned by the central runtime.

## Signed webhook ingress

Send JSON to `POST /saturnbot/webhook` with `x-saturnbot-timestamp` (Unix seconds), `x-saturnbot-delivery` (stable delivery ID), `x-saturnbot-source`, and `x-saturnbot-signature` (hex HMAC-SHA256). Sign the UTF-8 bytes of `JSON.stringify([timestamp, deliveryId, source]) + '\n'` followed by the exact raw request body, using the configured webhook secret; all three header values are strings. The JSON array separates the identities even when they contain periods. The Host enforces its configured replay window and body limit. A duplicate identity and identical content returns acceptance with `duplicate: true`; changed content returns HTTP 409. Transient storage failure returns HTTP 503, allowing retry with the same identity and payload. Successfully stored receipts become available to `webhook.inbox` on the next evaluation.
