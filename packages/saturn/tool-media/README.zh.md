---
description: "ctx.media 与五个面向模型的媒体生成工具（图像/视频/音频/动作迁移），覆盖 gemini、openai、higgsfield 三个供应商——每一次计费调用都会先经过 ctx.approval 的批准,才会发出网络请求。"
kind: "package-reference"
---

# @saturnai/dsh-tool-media

[English](README.md) | 中文

## 摘要

**为 Saturn AI harness 提供的 Higgsfield 级媒体生成能力。** `ctx.media` 是覆盖三个供应商后端的统一接口——**gemini**（图像走 `interactions` REST 端点,视频走 Veo 3.1 的 `predictLongRunning` 异步操作）、**openai**（图像,可选）、**higgsfield**（`docs.higgsfield.ai` 的异步任务 API,是唯一接入动作迁移/物体替换的供应商）——以 `media_generate_image`、`media_generate_video`、`media_generate_audio`、`media_motion_transfer`、`media_job_status` 五个模型可见工具的形式暴露。本包范围内的每个供应商都会产生真实费用;因此每次调用在发出计费网络请求之前,都会通过 `ctx.approval` 请求批准——批准理由中会写明预估的美元成本——无论权限预设如何,且在没有 agent 或没有可用的批准服务时会直接关闭失败(绝不会静默花钱)。生成的资产会写入 `<workspace>/.saturn/media/` 并以文件引用的形式返回,绝不会把字节内容直接交给模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

安装该插件,并为部署已有凭据的供应商配置对应的区块;没有配置区块的供应商仍会注册其工具,只是任何路由到它的调用都会以清晰的凭据错误失败,而不会崩溃。

### 何时选择它

当需要面向模型的图像、视频、音频或动作迁移/物体替换生成,并且要求(a)走真实、已验证的供应商契约而非猜测的契约,(b)绝不在未经人工明确批准并展示成本的情况下花钱时,选择本包。若目标是 Mac/本地的 $0 生成通道(另一个无关的工具),或部署永远不会为下列三个供应商中的任何一个付费,则跳过本包。

### 最小配置

```yaml
- id: tool-media
  name: '@saturnai/dsh-tool-media'
  config:
    gemini:
      apiKey: !!js process.env.GEMINI_API_KEY
    higgsfield:
      apiKey: !!js process.env.HIGGSFIELD_API_KEY   # "{key_id}:{key_secret}", see below
```

工具一览:

| 工具 | 参数 | 行为 |
|---|---|---|
| `media_generate_image` | `prompt`(字符串)、`provider?`、`model?`、`params?` | 生成一张图像。默认供应商为 `gemini`(`gemini-3.1-flash-image`,每张 1K 图像 $0.067,2026-09-15 验证)。 |
| `media_generate_video` | `prompt`、`provider?`、`model?`、`params?` | 生成一段短视频。默认供应商为 `gemini`(Veo 3.1,标准档每秒 $0.40——fast/lite 档见价格表)。`params` 接受 Veo 自身的 `aspectRatio`、`durationSeconds`(`"4"`\|`"6"`\|`"8"`)、`resolution`、`personGeneration`,以及用于图生视频的 base64 `image`。 |
| `media_generate_audio` | `prompt`、`provider?`、`model?`、`params?` | 仅路由到 `higgsfield`;**必须**提供 `params.modelPath`(见已知限制)。 |
| `media_motion_transfer` | `prompt`、`model?`、`params?` | 仅 Higgsfield 支持的"Genjutsu"级动作迁移/物体替换;**必须**提供 `params.modelPath` 与 `params.body`(见已知限制)。 |
| `media_job_status` | `id`(字符串) | 按此前调用返回的 id 重新读取已解析完成的任务。 |

各供应商的配置键(均位于 `gemini:` / `openai:` / `higgsfield:` 下):

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | — | 内联凭据。`gemini`/`openai`:API key。`higgsfield`:组合字符串 `"{key_id}:{key_secret}"`(见下文)。 |
| `apiKeyEnv` | `GEMINI_API_KEY` / `OPENAI_API_KEY` / `HIGGSFIELD_API_KEY` | 当 `apiKey` 缺省时,通过凭据接缝解析的引用名。 |
| `baseURL` | 供应商文档中的默认根地址 | REST 端点根路径。 |
| `imageModel` / `videoModel` / `imageModelPath` | 供应商当前的默认模型 | 可按部署覆盖。 |
| `timeoutMs`、`pollIntervalMs`、`pollTimeoutMs` | 各供应商相应默认值 | 单次请求超时与异步任务轮询预算。 |

**Higgsfield 的凭据由两部分组成,以一个冒号连接。** `docs.higgsfield.ai/docs/authentication`(2026-09-15 验证)要求 `Authorization: Key {key_id}:{key_secret}`——而不是单一的 bearer token。由于 SPEC §3 C7 只命名了一个凭据,本包没有新增第二个配置字段,而是让单一的 `HIGGSFIELD_API_KEY` 凭据直接保存已经组合好的 `"{key_id}:{key_secret}"` 字符串;`parseHiggsfieldCredential` 按第一个冒号切分。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

**花费闸门(spend Gate)。** `MediaService.generate()` 先解析本次调用的成本——gemini 查已验证的价格表,openai 要求显式覆盖(本次会话未能获得已验证价格),higgsfield 则实时调用 `POST /estimate/{modelPath}` 获取报价——然后调用 `ctx.approval.request({ agent, toolName, callId, reason, signal })`,并在 `reason` 中写明成本(例如 `Generate image via gemini/gemini-3.1-flash-image — estimated cost $0.067 USD. Prompt: "…"`)。只有 `'allowed-once'` 会放行;`'rejected'`/`'cancelled'`/`'unavailable'` 各自抛出不同的错误信息,没有 agent 或没有已装配批准服务的调用会在触碰网络之前就抛出——由于本包没有任何免费供应商,不存在能绕过此闸门的权限预设。唯一需要说明的例外:Higgsfield 的 `/estimate` 调用本身免费且只读(`docs.higgsfield.ai/docs/concepts/billing-and-retention`),因此它会在批准之前运行,用于填充成本这一行;真正计费的 `POST /{modelPath}` 提交调用则绝不会。

**重定向策略。** 每一个携带凭据的请求都使用 `redirect: 'error'`(`fetchNoRedirect`),沿用 `tool-describe-image` 的约定——bearer/API key 永远不会被转发到部署未配置的主机。唯一有文档记录的例外是 Gemini 自身的 Veo 视频下载步骤:Google 的 `ai.google.dev/gemini-api/docs/veo` 快速上手示例在携带 `x-goog-api-key` 请求头的同时跟随了已签名 `video.uri` 的重定向,因此 `fetchAllowingRedirectTo` 只允许恰好一跳,且只能跳回配置的 `baseURL` 自身的主机——跳到任何其他主机都会抛出异常。

**统一接缝下的多供应商**(`src/providers/{gemini,openai,higgsfield}.ts`),每个都针对本地 HTTP 测试夹具独立完成单元测试(测试中没有真实网络调用):`gemini.ts` 实现了 `interactions` 图像端点以及 Veo 的 `predictLongRunning` 提交→轮询→下载流程;`openai.ts` 实现了 `images/generations`;`higgsfield.ts` 实现了针对异步任务 API 的提交/状态/取消/估算/轮询。`MediaService`(`src/index.ts`)就是这层接缝:它为每次调用解析供应商、在批准闸门之后才发出网络调用、把结果字节写入 `<workspace>/.saturn/media/<uuid>.<ext>`,并按 id 缓存每一个终态任务,供 `media_job_status` 之后重新读取。

**一处有文档记录的接口扩展。** SPEC §4 将 `ctx.media` 的 `generate(req): Promise<Job>` 固定为单一对象签名,其中没有位置容纳 `Agent`——但 `ctx.approval` 从根本上需要一个 agent 才能路由其提示。因此 `MediaService.generate()` 接受一个可选的第二参数 `exec`(`{ agent?, callId?, signal?, toolName? }`);仅按固定形状调用 `generate(req)` 的消费者依然能通过类型检查并正常运行,只是会收到"没有 agent 可用于路由批准提示"这一关闭失败的错误——这是正确的,因为本包中的每个供应商都会产生费用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [工具目录](../../../docs/tool-catalog.zh.md)
- [批准接缝](../../interaction/user-approval/README.zh.md)
- [凭据接缝](../../credentials/credentials/README.zh.md)
- [`tool-describe-image`](../../vision/tool-describe-image/README.zh.md)——本包沿用的凭据接缝/拒绝重定向客户端模板
- Gemini:[图像生成](https://ai.google.dev/gemini-api/docs/image-generation)、[Veo](https://ai.google.dev/gemini-api/docs/veo)、[定价](https://ai.google.dev/gemini-api/docs/pricing)——均于 2026-09-15 实时抓取
- Higgsfield:[API 文档](https://docs.higgsfield.ai/docs)——于 2026-09-15 实时抓取(quickstart、authentication、requests/lifecycle、polling、errors、billing-and-retention、`openapi.json`)
- [添加一个带工具的包](../../../docs/cookbook/adding-a-package.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 工具模式

#### 模型看到的内容

[工具目录](../../../docs/tool-catalog.zh.md#saturnaidsh-tool-media)中为 `media_generate_image`、`media_generate_video`、`media_generate_audio`、`media_motion_transfer`、`media_job_status` 生成的模式。每个生成类工具的描述都声明了它会产生费用且需要批准;供应商端点、凭据名称与内部轮询参数均不面向模型。

#### Token 影响

工具注册期间,每次请求的模式开销固定。

#### KV 缓存影响

只要模式与描述不变,前缀即保持稳定。

### 结果

#### 模型看到的内容

一个 `MediaJob` 值(`id`、`status`、`assets: [{path, mimeType, url?}]`、`cost: {estimatedUsd, provider, model}`、`error?`),以简短文本摘要的形式呈现——列出任务 id、状态、解析出的成本,以及每个资产在工作区中的路径——绝不会呈现资产本身的字节内容。被拒绝/取消/无法获得批准,或供应商/配置错误,都会以带有 `media:` 前缀、指明具体原因的错误信息呈现。

#### Token 影响

按调用而定;这些工具除各自的模式外不添加任何持久化的提示词区块。

#### KV 缓存影响

仅追加;新出现的内容跟随可复用的请求前缀,不会使已有的 KV 缓存条目失效。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- **Genjutsu(动作迁移/物体替换)没有已发布的 REST 路径**——`docs.higgsfield.ai` 公开的 `openapi.json`(2026-09-15 抓取,共 50 个端点)中没有任何动作迁移/物体替换/genjutsu 操作;只有另一个已连接的 Higgsfield MCP 集成以内部模型 id(`hf_mult_motion_control`、`hf_mult_replace_object`)的形式暴露了它,那是与本包不同的接入面。`media_motion_transfer` 要求调用方提供确切的 `params.modelPath` 与 `params.body`,而不是猜测一个 URL;一旦 Higgsfield 发布该端点,补上一个真实默认值只是一个小的后续工作(只需修改 `generateWithHiggsfield` 中的这一处判断,而不用改动周边架构)。
- **没有已验证的 OpenAI 单张图像价格**——公开定价页面对本次会话的抓取器只返回了重定向、没有静态内容;端点与当前模型 id(`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2`)已针对 `developers.openai.com` 实时确认,但 `provider: 'openai'` 的 `media_generate_image` 需要显式的 `params.pricePerImageUsd`,拒绝猜测。后续会话应重新抓取 OpenAI 的定价页面(或其 API 自身的成本上报字段,如果存在的话),再移除这一要求。
- **`generate()` 会阻塞到任务终态,而不是立即返回 `'queued'`**——包括在内部轮询 Higgsfield 的状态端点与 Veo 的长时间运行操作,以各供应商的 `pollTimeoutMs` 为界。因此 `media_job_status` 大多是重新读取已缓存的终态结果,而不是恢复一个真正仍在进行中的轮询;若需要真正的"提交后即忘、之后再轮询(甚至换一个进程轮询)",需要后续工作把被跟踪的任务表持久化到进程内存之外。这是本次会话的有意范围决策,而非疏漏——详见 `MediaService` 的类文档。
- **gemini/openai 尚无已验证的音频契约**——Gemini 定价页面列出了 TTS/音乐模型(`gemini-3.1-flash-tts-preview`、`Lyria 3.5`),OpenAI 也有自己的音频 API,但本次会话未抓取二者的请求/响应契约;`media_generate_audio` 仅通过 `higgsfield` 路由(其本身也需要显式的 `params.modelPath`,原因同上文的 Genjutsu 缺口——公开的 `openapi.json` 50 条路径列表中同样没有明显的音频端点,尽管状态模式的 `audio`/`audios` 输出字段暗示某些账户层级上存在这样的端点)。
- **不会记录任何 `x-goog-api-key`/`Authorization` 值**——但本包本身并不会从*另一个*插件可能安装的全局调试/追踪日志中去做脱敏处理;这一责任属于所装配的日志层,与 `tool-describe-image` 相同。
- **未实现 webhook 投递**——Higgsfield 支持通过 `hf_webhook` 查询参数进行基于推送的完成通知(`docs.higgsfield.ai/docs/how-to/webhooks`),可以省去上面的轮询预算;但本包没有用于接收此类通知的入站 HTTP 接口。

<a id="dev-note"></a>
### 开发者说明

<details>
<summary>供维护者参考的工作背景——点击展开</summary>

于 2026-09-15 作为 SaturnAI 升级扇出的 SPEC §3 C7 构建。本包实现的每一个 REST 契约(Gemini 的 `interactions` + Veo 的 `predictLongRunning`,Higgsfield 完整的异步任务 API)都是本次会话用 `curl` 针对供应商自身当前文档实时抓取的,而非沿用训练时的记忆或第三方聚合器数据;`src/pricing.ts` 中的每一条价格都附带确切的来源 URL 与 `2026-09-15` 的 `verified` 日期。在文档未能清晰到足以诚实实现的地方(OpenAI 定价、Higgsfield 的 Genjutsu 端点、gemini/openai 音频),本包在代码与本文档中如实说明,而不是去猜测。

</details>

**运行时不变量:** 未发布配套包:`ctx.media` 是本包唯一的跨插件接口,由接入它的角色配置(按 SPEC §4,SaturnBot 的 `creative`/`growth` 角色)消费——关于超出固定 `generate(req): Promise<Job>` 签名之外那处有意扩展,见上文的 `ctx.media` 接口说明。
