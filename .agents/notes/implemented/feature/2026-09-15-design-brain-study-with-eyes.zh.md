# Agent Note: 设计大脑用眼睛研究

Status: implemented

[English](2026-09-15-design-brain-study-with-eyes.md) | 中文

## Problem

设计大脑自己的系统提示逐字告诉智能体，它的工具「不会自动检查已渲染的网站」——对 `compose`/`review` 而言这话没错，但这句话读起来更像是对流程中任何视觉检查的一概否认。`compose` 的响应（参考 slug、一段文字方向、抄袭/规避清单）从未变成模型真正看到的图像；`review-web.mjs` 捕获的截图也始终只是脚本打印出路径的本地文件，从未成为模型看到的内容。一个只依照提示词和技能文本行事的模型，没有任何办法把某个参考缩略图或它自己构建出的截图当作像素摆在自己面前——它只能阅读描述这些内容的文字。支持视觉的路由已经在 master 落地（`7ee514a0f2`，`packages/core/agent/src/model-selection.ts`）：任何请求携带的图像内容块现在都会自动交给具备图像能力的模型处理。缺的从来不是路由——而是从未有任何环节真正附上过一张图像。

## Decision

新增 `design_study_references({ slugs, prompt? })`，一个一方工具（`packages/saturn/design-brain/src/study-references.ts`），而非 `mcp__saturnai__*` MCP 调用——它直接与公开的 `https://saturnai.tools/design/thumbnails/<slug>.jpg` 主机通信，因此无论 MCP 连接是否存活都能工作。它会先用 `/^[a-z0-9][a-z0-9-]{0,80}$/` 校验每个 slug（不允许路径穿越，不允许臆造 slug），再发起任何网络调用；通过一个拒绝重定向、限制 10 MiB、按 JPEG/PNG/WebP 魔数字节校验的 HTTPS 客户端取回缩略图（`packages/vision/tool-describe-image` 的约定，直接复制而非导入——设计大脑并不依赖这个兄弟包）；把每张取回的缩略图写入 `<workspace>/.saturn/refs/<slug>.jpg`，并通过 `ctx.attachments.saveImage` 提交（`packages/fs/tool-fs/src/read-image.ts` 生成持久 `ImageBlock` 的约定），使其能作为真实图像——而非仅仅一个文件名——出现在紧接着的下一轮模型对话中。一段文字说明列出每一个成功与未命中的 slug；404、其他非 2xx 状态，或无法识别的内容体，都只算一行「未命中」，绝不会抛出异常——六个参考里的一个坏引用不该让整次研究失败。而重定向或超出上限的响应会让整次调用直接抛出拒绝：两者都意味着请求已偏离主机声明的约定，这与「这个 slug 暂时没有缩略图」属于不同的失败类别。

该工具的*网络与取回行为*与该类管理的 `mcp__saturnai__` 连接/断开生命周期无关——它直接与公开主机通信，从不经过 MCP 传输——但它的*注册*会跟随同一个开关状态：`DesignBrainService.syncStudyTool()` 会在受管的 `saturn-design-brain` 偏好设置启用、或存在一个独立的 profile 行时注册它，否则将其销毁；调用点在服务初始化、`ensureConnected`（覆盖 `connect()` 的重试路径）、`disconnect()`，以及该服务自身的销毁 effect 中（见下文「修复轮次 1」——这推翻了本笔记最初「始终注册」的说法）。除此之外它还有自己的失败模式（未挂载 `ctx.attachments`）。`Config.thumbnailBaseUrl`（默认指向真实主机）让测试和未来的部署无需改动取回代码即可指向别处。

系统提示段落（`index.ts`）去掉了那句一概而论的否认，转而点名两个具体的后续步骤：对 `compose`/`search`/`pick` 返回的 slug 调用 `design_study_references`；在调用 `review` 之前用 `read_image` 查看智能体自己构建出的截图——`review` 评审的是提供给它的证据，它本身并不查看像素。`packages/skill/skill-premium-output` 的 `premium-web-experience/SKILL.md` 在「确立方向」之后新增了「用眼睛研究参考」步骤，在 `review-web.mjs` 步骤之后新增了「审视你构建的成果」步骤；`review-web.mjs` 现在会把自己的截图路径以带标签的列表打印到 stdout，供 `read_image` 使用，并点明必须去看的人是谁（智能体，绝不是脚本本身）。

## Alternatives considered

**在工具内部通过一次嵌套的视觉模型调用来完成参考研究。** 已拒绝：只要请求携带图像内容块，harness 已经会解析出具备图像能力的模型（已落地的预调度钩子），工具内部再发起第二次 LLM 调用只会重复这条路由，并把研究过程藏在调用智能体自身上下文之外——这项工作的重点正是让「智能体」去看，而不是一次隐藏的子调用。

**在 `compose` 的响应中加入 `thumb` URL 字段，让智能体用 `describe_image` 处理它。** 对本 cell 而言已拒绝：`compose`/`review` 是托管的 MCP 工具，在本包的写入范围之外；而且 `describe_image` 从不向对话返回图像块（这是设计使然，为了让被描述过的图像不再重新进入上下文）——这是「让智能体去看」问题的错误工具，却是「用文字总结这张图」问题的正确工具。

**把 `design_study_references` 的注册与 MCP 工具相同的连接/断开生命周期绑定。** 最初考虑过后拒绝，理由是「没必要这么复杂」——在下文「修复轮次 1」中被推翻：那个「没必要」低估了真实代价——一个始终注册的工具，即使设计大脑关闭，也会持续消耗每个 profile 的上下文窗口去承载它的 schema；而它唯一被认可的 slug 来源（`compose`/`search`/`pick`）又不可达，系统提示里的使用说明也被抑制，这恰恰会诱使模型臆造 slug——而这正是工具描述本身所禁止的。

## Consequences

研究参考的模型现在会在写下方向之前先看到真实像素，也会在调用 `review` 之前先看到自己构建出的截图——这与技能文本一直以来对模型自身产出的要求一致，如今扩展到了大脑的参考资料上。没有挂载附件存储的部署会收到明确的逐次调用错误，而不是静默空操作或退回到纯文字描述——这个工具从不会退化为用文字描述一张图像。

`scripts/review-web.mjs` 本身无法把 `report.json` 的 `visualQualityAssessed` 置为 `true`：一个 Node CLI 的 stdout 可以打印带标签的截图路径列表，但它无法把一个图像内容块真正塞进调用模型的上下文——只有调用智能体对着这份 stdout 调用 `read_image`，才能真正把像素摆到模型面前。因此 `visualQualityAssessed` 始终硬编码为 `false`；脚本没有任何办法得知调用智能体后续是否真的看了，所以 `false` 是诚实的值，而不是需要修复的缺陷。技能文本（「审视你构建的成果」一节）才承载了真正的指令，并点明了机制（`read_image`）。

## 修复轮次 1（Mars 评审）

Mars 的新上下文评审发现 `registerStudyReferencesTool` 在 `DesignBrainService` 的构造函数中被无条件调用——上面「已考虑的替代方案」对「为其加门槛」代价的判断是错的。修复方式：`registerStudyReferencesTool` 现在返回它的 `ctx.tools.register()` 销毁函数，而不再是 `void`；新增的 `syncStudyTool()` 方法会依据 `status()` 早已上报的同一套开关状态（`preference.get().enabled` 或存在独立的 profile 行）来注册/销毁它，调用点分布在服务初始化、`ensureConnected`、`disconnect`，以及该服务自身的销毁 effect 中。`composition.spec.ts` 的工具计数断言，原先在 GREEN 提交中被放宽为只过滤 `mcp__saturnai__` 前缀，现已恢复为断言真实、完整的工具列表——无论是在禁用状态（`[]`）还是在已连接状态（MCP 工具加上 `design_study_references`），见 `composition.spec.ts:56` 与 `:82`。系统提示段落的正文也被提取为一个导出的 `DESIGN_BRAIN_PROMPT_SECTION_TEXT` 常量，使其无需真实的 `mcp__saturnai__` 连接即可直接测试；其文字现在也点明了模型必须写入的 `.saturn/reference-study.md` 产物路径，而不再只出现在工具描述里。
