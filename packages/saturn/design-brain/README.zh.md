---
description: "可选的 SaturnAI 设计工具，提供持久选择、经验证的工具可用性和 Host 管理的连接。"
kind: "package-reference"
---

# @saturnai/dsh-design-brain

[English](README.md) | 中文

## 概述

将 SaturnAI 设计指导和基于证据的评审工具连接到 Web 或桌面配置中的智能体。用户可在 First Light 或「设置 → 模型」中选择启用，选择会在重启后保留。新配置不会发起连接请求。内置高品质产出指南无需此服务；工具调用会将选定的需求和证据发送到配置的外部端点。本包还注册了 `design_study_references`——一个独立的一方工具（并非 `mcp__saturnai__*` MCP 调用），它会将设计库参考缩略图作为真实图像取回，让模型用眼睛研究它们；它的注册与上述 MCP 连接生命周期无关，始终保持可用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

内置 Web bundle 将此连接器与 Host 设置、工具注册表、系统提示和 Loader 服务一起挂载。「设置 → 模型」提供「连接工具」「刷新状态」和「断开连接」。保存的启用选择会在 Host 启动时重连；断开会关闭托管传输并注销其工具。直接编辑 `saturn-design-brain.enabled` 设置命名空间需重启后生效；连接控件会立即持久化并应用变更。

同一作用域中名为 `saturnai` 的 MCP 配置条目拥有自己的连接。连接器会复用它，不会挂载另一个服务器或改动该条目，包括条目已停用的情况。界面引导用户管理配置文件，而不提供无效的断开操作。其他智能体作用域中的条目不会阻止全局托管连接。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `https://saturnai.tools/api/mcp` | Host 控制的 Streamable HTTP URL；限 HTTP(S)，不含凭据、查询或片段 |
| `connectTimeoutMs` | `15000` | 握手、初始化通知和首次工具注册的期限 |
| `toolCallTimeoutMs` | `120000` | 每次后续 MCP 工具调用的期限 |
| `headers` | `{}` | 可选部署凭据；连接状态绝不返回此字段 |
| `thumbnailBaseUrl` | `https://saturnai.tools/design/thumbnails/` | `design_study_references` 取回 `<slug>.jpg` 的 Host 基础地址 |

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 拥有一个串行的连接生命周期。成功要求生产 MCP 监督器报告已连接的实例，且同一工具注册表包含 `mcp__saturnai__compose` 和 `mcp__saturnai__review`。工具目录不完整、传输失败、配置条目停用或超时都保持不可用。刷新状态反映当前生命周期，不保证未来远程调用一定成功。浏览器挂载生成的 Remote 定义，不以单独的 fetch 探测作为智能体已获得工具的证明。

连接器将期限交给 MCP 监督器，后者在等待静止前关闭实际传输。这会限制停滞的初始化或首次工具发现请求。所属对象释放时会取消资源，防止延迟完成的工作读取已拆除的服务。持久选择通过现有设置提供方保存；偏好设置不复制凭据或对话内容。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端](../../mcp/mcp-client/README.zh.md)——传输生命周期和工具语义。
- [高品质产出指南](../../skill/skill-premium-output/README.zh.md)——无需外部连接的内置工作流程，包括本工具服务的「用眼睛研究参考」与「审视你构建的成果」步骤。
- [模型设置](../../client/ui-settings-models/README.zh.md)——提供方和连接控件。
- [`describe-image`](../../vision/tool-describe-image/README.zh.md) 与 [`tool-fs` 的 `read_image`](../../fs/tool-fs/README.zh.md)——`design_study_references` 所遵循的拒绝重定向 HTTPS 客户端与持久图像块约定。

<a id="model-experience"></a>
## 模型体验

### 可选设计上下文

#### 模型可见内容

当 SaturnAI 已连接且工具在请求作用域中可见时，`saturn:design-brain` 段引导模型按工具 schema 处理相关工作、在局部修改中复用已有上下文，并如实报告失败。现在它还指出两个具体后续步骤：对 `compose`/`search`/`pick` 返回的 slug 调用 `design_study_references`；在调用 `review` 之前，用 `read_image` 查看自己构建的截图——`review` 评审的是提供给它的证据，它本身并不查看渲染出的像素。工具定义和结果遵循 MCP 客户端与工具注册表的常规注册与执行路径。

#### Token 影响

连接后的段落增加一段固定文字。可用 MCP schema 和明确请求的工具结果产生正常的上下文成本。停用的连接不增加 `saturn:design-brain` 提示文字，但 `design_study_references` 本身仍保持注册——无论连接状态如何，其自身描述都会产生固定成本，详见下一个模型上下文条目。

#### KV Cache 影响

连接状态和工具可见性不变时，段落保持稳定。连接、断开或失去可用性会改变组合的提示与工具集合。常规 request/header 和工具结果记录仍是模型实际收到内容的证据。

### 用眼睛研究参考

#### 模型可见内容

`design_study_references({ slugs, prompt? })` 接受 1 到 6 个设计库 slug——必须是此前 `compose`/`search`/`pick` 调用返回的原样值，绝不可臆造——并通过一个拒绝重定向、限制 10 MiB、按魔数字节校验 JPEG/PNG/WebP 的 HTTPS 客户端取回每个 `https://<thumbnailBaseUrl>/<slug>.jpg`。每张成功取回的图像都会写入 `<workspace>/.saturn/refs/<slug>.jpg`，并作为真实的图像内容块返回（通过 `ctx.attachments.saveImage`，前提是已挂载附件存储——否则该工具会以明确的错误拒绝执行，而不是静默降级），同时附带一段列出每个成功与未命中 slug 的文字说明。没有已发布缩略图的 slug（HTTP 404、其他非 2xx 状态，或无法识别的内容）只算一行「未命中」，绝不会让整次调用抛出异常；而重定向或超出上限的响应会让整次调用直接抛出拒绝，因为两者都意味着请求已偏离该主机声明的约定。

#### Token 影响

注册后的固定工具 schema 成本（见上文 Token 影响），加上每次调用：每个请求的 slug 一行摘要，每个成功取回的缩略图一张图像——受 1-6 个 slug 上限约束，因此一次调用最多产生 6 张图像。

#### KV Cache 影响

每次调用的结果都是全新的一轮（取回的字节和图像附件 id 每次不同），跨调用没有可复用的缓存。工具 schema 本身相对上文所述的 KV cache 边界保持稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 连接器提供指导和工具访问，不保证视觉质量或模型遵循指令。
- 现有配置条目仍由部署管理。配置连接失败时必须通过该配置修复或重启。
- 端点由 Host 控制。浏览器用户不能通过此 API 提供任意 URL 或读取部署请求头。
- 外部评审使用调用方提供的证据。连接时不会静默捕获或上传项目文件、截图或对话历史。
- `design_study_references` 需要挂载 `ctx.attachments` 服务；未挂载该服务的部署会收到明确的逐次调用错误，而不是静默空操作。它绝不会退回到用文字描述图像。
- `design_study_references` 始终注册——它并不受限于上方的 `mcp__saturnai__` MCP 连接，因为它直接与固定的缩略图主机通信。它目前还没有自己的开关；按部署整体停用该工具尚属后续工作（需要一个类似 `saturn-design-brain.enabled` 的设置字段）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-host-owned-design-brain.zh.md)解释了所有权和有界传输期限。[用眼睛研究的说明](../../../.agents/notes/implemented/feature/2026-09-15-design-brain-study-with-eyes.zh.md)解释了为何 `design_study_references` 是一方工具而非托管 MCP 调用，以及为何它的注册与连接生命周期无关。

</details>
