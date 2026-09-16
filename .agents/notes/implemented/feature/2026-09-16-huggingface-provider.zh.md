# Agent 备注：模型选择器中的 Hugging Face

Status: implemented

[English](2026-09-16-huggingface-provider.md) | 中文

## 问题

用户希望在模型选择器中切换任意 Hugging Face 模型。pi-ai 目录只提供一份较短的静态 `huggingface` 列表，而 Hugging Face 路由器提供数百个对话模型，其在线提供方每小时都在变化；声明路由此前只能提供静态 `models` 数组。

## 决策

`dsh-llm-pi-ai` 为声明路由新增通用的 `modelsEndpoint: true` 标志（`src/live-models.ts`）：路由的模型来自 `GET {baseURL}/models`，成功列出后服务十分钟（失败的列出 30 秒后重试，已存密钥变化时立即重新获取），并合并在路由自身的 `models` 之后，后者作为种子与失败回退。带 `providers[]` 数组的条目只有在某个提供方为 `live` 时才保留；上下文取最大的在线 `context_length`，工具支持取任一在线 `supports_tools`，只有 `architecture.input_modalities` 声明时才支持图片输入。路由接受 `org/name:<策略|提供方>` 以及任意键入的 `org/name` id。路由器的 401/402/403/404/429 回答会变为 `[huggingface:<kind>]` 失败；403（受限模型，或令牌缺少“调用 Inference Providers”权限）的代码是 `ACCESS_DENIED` 而非 `AUTH`，因此任何客户端都不会将其报告为密钥无效。其他 `modelsEndpoint` 路由的列表失败使用与提供方无关的措辞。基础 bundle 声明 `huggingface`（`HF_TOKEN`、三个种子、`supportsDeveloperRole: false`）。

输入框模型选择器显示 Hugging Face 分组，带搜索框、上下文与工具徽标、键入模型 id 的入口，以及路由面板（最快、最便宜、偏好、每个在线提供方）。设置 → 模型渲染 Hugging Face 卡片：带细粒度令牌链接的令牌引导、带上下文与工具徽标的可搜索在线列表、路由策略、固定到路由的 `models`，以及本地化的路由器失败。

## 考虑过的替代方案

**仅针对 HF 的发现代码。** 未采用：该标志是通用的，也服务自托管的 TGI、vLLM 与 LM Studio 路由；只有错误标签与 `providers[]` 过滤是路由器形状的，而过滤对普通列表不产生作用。

**为上下文、工具与在线提供方新增 wire 字段。** 本单元未采用：目录模型形状与 `LlmDiscoveredModel` 位于其写入范围之外的包中。适配器把这些事实放在模型 `description` 行（`131K context · tools · via groq, cerebras`）中，选择器将其解析为本地化徽标与路由选项。模型卡片从 Host 模型目录读取同一行来显示工具徽标。

## 影响

在设置 → 模型中粘贴一次令牌，即可选择所有在线对话模型。对话记录把带标签的失败渲染为本地化的 `hf.error.<kind>` 文案，优先于通用的密钥无效文案；不带标签的失败保持原样。模型卡片提供路由策略但不提供按提供方路由，因为发现结果不携带提供方列表；输入框选择器两者都提供。真实路由器行为只通过 fixture 与本地 mock 服务器验证，从未访问真实网络。
