# Agent Note：高峰灯是 DeepSeek 引擎容量 chrome；会话用量是真实 token

Status: implemented

[English](2026-09-15-peak-usage-dsh-chrome.md) | 中文

## 问题

高峰 / 低峰灯是 DeepSeek 引擎的容量窗口，不是 Saturn 身份，却对每个会话都渲染。输入框 chrome 没有真实的会话 token 合计。First Light 仍以「在此连接 DeepSeek」起句，About 的 fork 说明需要留在许可证行，而不是产品身份。

## 决定

- PeakRail 注入当前会话 `modelSelection` 的提供方，仅在 `deepseek-official` 时挂载指示灯。其他引擎或尚未选择时隐藏栏位，并释放 `--dsh-shell-trailing-extra`。
- 输入框尾部一枚安静的 `UsageChip` 读取已有的 `tokenUsage` 投影（未缓存输入 + 缓存 + 输出）。在提供方报告非零合计之前不渲染。没有进度条，也没有编造的美元数——token-meter 没有货币表，DeepSeek 峰谷计价仍由指示灯承担。
- First Light / 模型文案连接的是模型引擎；DeepSeek 仍是列出的引擎之一。About 仍以产品名为标题；DSHCode / DeepSeek Harness 只出现在 MIT 许可证行。
- `x-deepseek-harness-*` 请求头仍只属于 `packages/llm/llm-deepseek`（本切片未改该包）。

## 曾考虑的替代方案

- 只要目录默认是 DeepSeek，即使选择为空也显示指示灯。否决：「所选提供方」是 `modelSelection` 的 next/lastUsed id；未知不是 DeepSeek。
- 仿占用率的假费用条。否决：token-meter 没有美元表；没有金额的进度条是表演。
- 把用量挂到顶栏 overlay。否决：会话 token 属于输入框旁，安静呈现。

## 后果

- 尚无 `modelSelection` 的全新会话会隐藏高峰灯，直到选出路由或请求头落地。
- 用量只在真实提供方用量之后出现；空会话保持干净。

## 文件

- `packages/client/ui-conversation/src/client/skeleton/{PeakChip,selected-provider,session-usage,UsageChip}.*`
- `packages/client/ui-conversation/src/client/{apply.ts,locales.ts,skeleton/InputBar.tsx}`
- `packages/client/ui-settings-models/src/client/locales.ts`
- `apps/desktop/src/about.ts`（文案未改；测试锁住身份规则）

## 验证

- PeakRail：DeepSeek 显示灯；openai / 空隐藏；离开 DeepSeek 释放预留。
- UsageChip：缺席/零用量不渲染；真实分桶显示 12.4K 入 · 3.1K 出；无 `$`。
- First Light 文案门禁：不以「Connect DeepSeek」起句。
- About：标题为 Saturn AI；fork 名称只在许可证行。
