---
description: "为 dsh Web client 品牌 slot 提供的 Saturn AI 品牌占用者：侧边栏标志与文字标，不含任何 DeepSeek 名称、商标或美术资源。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-brand-saturn

[English](README.md) | 中文

## 概述

为 dsh Web client 品牌 slot 提供的 Saturn AI 品牌占用者。这是一个纯浏览器端 Cordis client 插件，占用两个 UI slot：`sidebar.brand.mark`（单色 Saturn 图形，使用 `currentColor` 与皮肤的 `--saturn-accent` token 内联绘制为 SVG）与 `sidebar.brand.name`（"Saturn AI" 文字标，没有美术资源）。对话头部保留其声明包自带的动态标志；文字标使用同一强调色，回退到语义化的 label 颜色。

## 目录

- [使用](#use)
- [布局](#layout)
- [许可证](#license)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use"></a>
## 使用

在 web profile 中组合此包，并移除（或停用）官方的 `ui-brand-official` 行；占用 slot 是唯一的组合路径——不存在品牌配置界面。注册集合具有声明感知能力（会等待侧边栏 slot 出现后才注册），因此在 HMR 下会作为一个整体安装与撤回。

```yaml
- id: ui-brand-official
  disabled: true
- insert:
    - id: ui-brand-saturn
      name: '@saturnai/dsh-client-ui-brand-saturn'
```

-----

<a id="layout"></a>
## 布局

| 文件 | 用途 |
|---|---|
| `lib/index.js` | 空的 host 侧 loader 挂载点（此插件不提供 node 行为）。 |
| `lib/client.js` | 浏览器半侧：slot 注册、文字标样式表、图形组件。 |

图形几何与产品美术资源中的 Saturn 标志共享（64 单位 viewBox，行星 r=15 居中，圆环 rx=27 ry=9.5 描边 4.5 倾斜 -18°，正面弧线通过裁剪重绘在底部之上）。

-----

<a id="license"></a>
## 许可证

MIT。此包不包含任何 DeepSeek 名称、商标或美术资源。

-----

<a id="model-experience"></a>
## 模型体验

### 侧边栏品牌展示

#### 模型可见内容

无。此插件把 `SaturnGlyph` 与 `SaturnName` 注册为纯展示组件，分别对应 `sidebar.brand.mark` 与 `sidebar.brand.name` slot；这两个 slot 及其渲染的任何 prop 都不会进入模型提示词、工具 schema 或工具结果。

#### Token 影响

无。此注册集合贡献零提示词 token；它是 UI slot 的浏览器渲染占用者，不是上下文来源。

#### KV Cache 影响

无。slot 占用状态在会话或 turn 之间从不以会改变组装请求的方式变化，因此不会使缓存前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 不存在品牌配置界面；更换标志或文字标需要组合另一个品牌包，而不是修改设置。
- 对话头部标志被刻意留空（见[使用](#use)）；期望此包同时为头部添加品牌的组合，需要自行添加该 slot。
- slot 占用假定声明这些 slot 的包（`ui-sidebar`、`ui-renderer`、`ui-conversation`）已先被组合；此包不声明它所占用的 slot。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
