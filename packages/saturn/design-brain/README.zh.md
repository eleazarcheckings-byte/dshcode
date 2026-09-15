---
description: "可选的 SaturnAI 设计工具，提供持久选择、经验证的工具可用性和 Host 管理的连接。"
kind: "package-reference"
---

# @saturnai/dsh-design-brain

[English](README.md) | 中文

## 概述

将 SaturnAI 设计指导和基于证据的评审工具连接到 Web 或桌面配置中的智能体。用户可在 First Light 或「设置 → 模型」中选择启用，选择会在重启后保留。新配置不会发起连接请求。内置高品质产出指南无需此服务；工具调用会将选定的需求和证据发送到配置的外部端点。

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
- [高品质产出指南](../../skill/skill-premium-output/README.zh.md)——无需外部连接的内置工作流程。
- [模型设置](../../client/ui-settings-models/README.zh.md)——提供方和连接控件。

<a id="model-experience"></a>
## 模型体验

### 可选设计上下文

#### 模型可见内容

当 SaturnAI 已连接且工具在请求作用域中可见时，`saturn:design-brain` 段引导模型按工具 schema 处理相关工作、在局部修改中复用已有上下文、检查实际渲染结果并如实报告失败。工具定义和结果遵循 MCP 客户端的常规注册与执行路径。此服务评审所提供的证据，不会独立检查已渲染的网站。

#### Token 影响

连接后的段落增加一段固定文字。可用 MCP schema 和明确请求的工具结果产生正常的上下文成本。停用的连接不增加设计大脑文字或工具。

#### KV Cache 影响

连接状态和工具可见性不变时，段落保持稳定。连接、断开或失去可用性会改变组合的提示与工具集合。常规 request/header 和工具结果记录仍是模型实际收到内容的证据。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 连接器提供指导和工具访问，不保证视觉质量或模型遵循指令。
- 现有配置条目仍由部署管理。配置连接失败时必须通过该配置修复或重启。
- 端点由 Host 控制。浏览器用户不能通过此 API 提供任意 URL 或读取部署请求头。
- 外部评审使用调用方提供的证据。连接时不会静默捕获或上传项目文件、截图或对话历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-host-owned-design-brain.zh.md)解释了所有权和有界传输期限。

</details>
