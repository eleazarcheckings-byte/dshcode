# Agent Note: 基于 gemini/openai/higgsfield 并置于花费闸门之后的媒体生成

Status: implemented

[English](2026-09-15-tool-media-generation.md) | 中文

## 问题

SaturnAI 之前没有从模型调用通向 Higgsfield 级图像/视频/动作迁移输出的路径。SaturnBot 的 `creative.generate` 只是一个单端点 webhook 桩(`{kind, prompt}` → 一个配置好的 URL),无法表达异步任务 id、各供应商专属参数、成本估算,或 Genjutsu 所需的参考/驱动素材——而且 harness 中没有任何机制会在花费真实成本之前,把一次生成调用的实际成本置于人工决策之后。

## 决策

新增包 `packages/saturn/tool-media`(`@saturnai/dsh-tool-media`),沿用 `packages/vision/tool-describe-image` 的凭据接缝/拒绝重定向客户端形态:一个提供 `generate(req, exec?)`/`status(id)` 的 `ctx.media` 服务,统一接缝下的三个供应商(`src/providers/{gemini,openai,higgsfield}.ts`),以及五个面向模型的工具(`media_generate_image`、`media_generate_video`、`media_generate_audio`、`media_motion_transfer`、`media_job_status`)。

本包实现的每一个 REST 契约都是本次会话(2026-09-15)用 `curl` 针对供应商自身当前文档实时抓取的,而非沿用记忆:Gemini 的 `interactions` 图像端点与 Veo 3.1 的 `predictLongRunning` 异步视频操作(`ai.google.dev/gemini-api/docs/{image-generation,veo,pricing}`),以及 Higgsfield 完整的异步任务 API(`docs.higgsfield.ai/docs/*` 及其发布的 `openapi.json`)。`src/pricing.ts` 中的价格表对每一条能够诚实验证的价格都附带确切来源 URL 与日期;对于本次会话无法诚实验证的价格或契约(OpenAI 的单张图像成本、Higgsfield 的 Genjutsu REST 路径、gemini/openai 的音频),对应工具会要求调用方显式提供数值,或直接拒绝运行,而不是去猜测。

每次调用都会先通过 `ctx.approval` 请求批准——理由中写明成本——然后才发出计费网络请求,且无条件执行(没有任何权限预设可以绕过,因为本包中没有免费供应商);缺少 agent 或批准服务会使调用关闭失败。`MediaService.generate()` 在 SPEC 固定的 `generate(req): Promise<Job>` 签名基础上,扩展了一个可选的第二参数 `exec`,携带 `ctx.approval` 路由其提示所需的 agent/callId/signal——固定的单对象 `req` 没有位置容纳 `Agent`,而批准从根本上需要一个。

## 考虑过的替代方案

**把一切都塞进现有的 `creative.generate` webhook 形状。** 已拒绝:该形状无法表达异步任务 id、各供应商专属参数(长宽比、时长、参考/驱动素材)或成本估算,而三个真实供应商的契约都不匹配单一的 `{kind, prompt}` → 一个 URL 的形状。

**从已连接的 Higgsfield MCP 的内部模型 id 中猜测 Genjutsu 的 REST 路径。** 已拒绝:`hf_mult_motion_control`/`hf_mult_replace_object` 是聚合器 MCP 自身的内部 id,而不是 REST 路径,且 Higgsfield 公开的 `openapi.json`(本次会话抓取,共 50 个端点)中没有任何动作迁移/物体替换操作。`media_motion_transfer` 转而要求显式的 `params.modelPath`/`params.body`。

**把 Higgsfield 的两段式凭据拆成两个配置字段。** 已拒绝:SPEC §3 C7 只命名了一个凭据(`HIGGSFIELD_API_KEY`);因此改为让这一个值直接保存已经组合好的 `"{key_id}:{key_secret}"` 字符串——正是 Higgsfield 自身的 `Authorization: Key {id}:{secret}` 请求头所需要的——由 `parseHiggsfieldCredential` 负责切分。

## 后果

任何装配了本包并为至少一个供应商配置了凭据的组合,都可以使用 `ctx.media`;SaturnBot 的 `creative`/`growth` 角色(或任何其他消费者)都可以按照固定的接口调用 `ctx.media.generate(req)`,获得一次经批准闸门把关的真实可用生成,而不再是一个桩。`media_generate_audio` 与 `media_motion_transfer` 目前都要求显式的 `params.modelPath`(这是有文档记录的,而非静默行为);一旦对应契约得到验证,为二者接入已验证的默认值将是一项小而独立的后续工作。`docs/tool-catalog.md` 需要一次 `doc-sync` 重新生成,才能纳入这五个新工具的模式(记为一项集成事项,不在本包范围内完成——本包的范围仅限于 `packages/saturn/tool-media/**`)。

提交轨迹（为 RED→green 审计披露）：本包的 `src/`、两份 README 以及 RED 规格中 mock HTTP 处理器的六行改动，落在提交 `78a06d26b1` 中，其主题写着 `docs(saturn): re-record translation-pairing sidecars for hygiene-docs READMEs`；RED 规格本身是 `25cb088cf6`，而 `git log --all` 中没有任何 tool-media 的 `feat(` 提交。该规格改动只调整了 mock（一个排队中的 Higgsfield 任务及其状态轮询），没有改动任何断言。请依据这两个哈希审计链条；[提交类型作用域闸门](../process/2026-09-16-commit-type-scope-gate.zh.md) 现在会在提交时拒绝这类错标。
