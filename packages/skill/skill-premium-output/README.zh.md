---
description: "面向 Saturn AI agent 的内置产出设计指导：共享策略、网站与动效工作流、交付物检查及部署覆盖配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-premium-output

[English](README.md) | 中文

## 概览

本插件通过现有提示词与技能注册表提供共享产出质量策略和三个内置技能。使用 base 的 profile 默认启用它，因此普通 standard、PTC、Cordis 和自定义 agent 都能获得相同要求，无需依赖用户的私有指令文件或外部 Design brain 连接。策略要求 agent 确定一致的设计方向、保存可用的初始版本、以完整增量逐步完善、检查渲染结果，并区分已完成检查与尚未验证的工作。

## 目录

- [使用本包](#use-this-package)
- [配置与作用域](#configuration-and-scope)
- [内置资源](#packaged-resources)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[dsh-base](../../bundle/base/cordis.patch.yml) 中的 `skill-premium-output` 条目为 `web`（含桌面端）、`headless`、`sdk` 和 `acp` 挂载提供器与策略。移除或禁用该条目会同时移除两项贡献。独立的 `sdk-minimal` bundle 不包含本插件。

插件依赖 `skills` 和 `systemPrompt`。当 agent 能解析 `skill` 工具时，策略会指引它加载匹配的指南。现有技能消费者发布可用目录，并将加载的完整指令记录为工具结果。没有该工具时，简短的共享策略仍然有效，也不会要求 agent 调用它。

<a id="configuration-and-scope"></a>
## 配置与作用域

`enabled` 默认为 `true`；设为 `false` 会禁用两项贡献。`policy` 替换共享策略文本，必须为非空字符串。部署可通过 profile patch 覆盖这些字段；patch 会替换该条目的完整 config。

```yaml
- id: skill-premium-output
  config:
    enabled: true
    policy: Preserve the client's design system. Inspect rendered work and report the checks actually completed.
```

内置技能使用等级 `600`。现有项目和用户同名技能按注册表的常规优先级覆盖它们，包括预设作用域中的提供器。交付物的品牌由用户请求与项目约定决定；本插件不会将 Saturn 自身的配色应用于客户项目。完整 persona 通过提示词注册表现有的完整提示词行为抑制该策略。插件不会更改模型选择、权限、委派限制或执行预算。

<a id="packaged-resources"></a>
## 内置资源

- [premium-web-experience](skills/premium-web-experience/SKILL.md) 涵盖网站方向、内容、交互、响应式状态与浏览器检查。其[浏览器检查助手](skills/premium-web-experience/scripts/review-web.mjs) 记录可观察检查；报告不代表审美评分。
- [purposeful-motion](skills/purposeful-motion/SKILL.md) 涵盖动效构图、状态表达、克制的氛围效果、减少动态效果以及渲染生命周期。其 [canvas 运行时示例](skills/purposeful-motion/recipes/canvas-runtime.mjs) 是可复用的起点。
- [premium-deliverables](skills/premium-deliverables/SKILL.md) 使用适当的渲染或执行检查，涵盖文档、演示文稿、数据及其他完整交付物。

每份指南返回自身资源目录的绝对路径。源码和安装包中的相对助手路径都以此目录为基准。读取指南不会启动脚本、安装浏览器、联系提供方或在用户主目录创建文件。读取失败通过技能注册表现有的技能不可用处理机制传递。

<a id="model-experience"></a>
## 模型体验

### 共享质量策略与按需指南加载

#### 模型看到的内容

`saturn:output-quality` 系统提示词段落包含[共享策略](src/policy.ts)。拥有可见 `skill` 工具的 agent 还会收到三个指南的使用指引。技能目录仅含摘要；工具结果携带选中指南的完整 Markdown 正文及其资源目录。

#### Token 影响

共享策略增加固定提示词内容；可选工具指引增加一个段落。指南正文仅在加载后进入上下文。除非 agent 读取，助手与示例不会被注入。

#### KV Cache 影响

策略与工具视图不变时，该段落保持稳定。现有 `request/header` 事件记录组装后的系统文本，现有技能目录与工具结果事件记录指南披露。不引入仅请求可见的修改或新事件类型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

这些工作流改善 agent 收到的指令，但不保证模型遵循、审美质量或结果已适合生产。尽早保存的指导不会强制预留 token，也不会改变推理强度。模型仍负责选择相关指南并执行检查。不会自动运行额外模型评审或付费提供方调用。

浏览器检查依赖 agent 可用的浏览器工具。内置助手需要其文档所述的本地运行时依赖；依赖不可用时应明确标记检查缺口。构建通过、截图文件或自动报告本身并不能证明视觉质量。完整自定义 persona 和 minimal 预设可有意省略这些指导。

Windows 的 workspace-write 沙箱目前会阻止 Playwright 所需的带管道子进程启动，即使 Chromium 已安装（[沙箱限制](../../sandbox/sandbox-windows-acl/README.zh.md#known-limitations-and-deferred-work)）。助手遇到 Windows `spawn EPERM` 启动拒绝时会报告检查不可用且未生成截图，并引导调用者使用已授权的浏览器集成，或由运维支持且保持 shell 策略的浏览器执行方式。它不会自动关闭沙箱。其他 Windows 限制也可能产生相同错误，因此诊断不会断言具体原因。

<a id="dev-note"></a>
## 开发说明

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-packaged-output-quality.zh.md) 说明共享部署归属与限制。单元测试覆盖配置、释放、优先级、工具可见性、资源路径与完整提示词行为。真实 Loader 夹具在已发布的 Headless profile 中以 native 和 PTC 模式运行脚本化模型。它检查持久化策略与指南输出，并证明已完成的文件写入在后续完善响应被截断时仍然保留，且该响应的工具调用不会执行。它不评估生成设计的质量或模型遵循情况。

**运行时不变量：** 不发布配套检查。本插件拥有不可变的内置内容和由 effect 管理的注册项，没有需要与独立可变状态对账的投影。
