---
description: "面向使用者和维护者的 read_pdf 与 read_notebook 模型侧工具说明，用于为智能体组合或调试文档访问能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-document

[English](README.md) | 中文

## 概述

`dsh-tool-document` 提供 `read_pdf` 和 `read_notebook` —— 这是 Claude Code 能原生读取、而本 harness 在此包之前无法打开的两种文件类型。`read_pdf` 从 PDF 中按页范围提取文本并返回总页数；`read_notebook` 按顺序返回 Jupyter（nbformat 4）笔记本的每个单元格及其来源与渲染后的输出,并对超大输出附带截断标记。两个工具都将读取限制在配置的工作区根目录内,且都不会修改文件。当模型需要直接查看 PDF 或笔记本文件时选用此包；其他所有文件类型仍由同级的 `dsh-tool-fs` 包的 `read` 工具负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `ctx.fs` 后端和 `ctx.tools` 运行时之后挂载本插件。不需要附件存储、沙箱或会话服务 —— 两个工具都通过 `ctx.fs` 解析路径,并自行将其限制在配置的 `workspaceRoot` 内。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-fs-local'
  config:
    cwd: /path/to/workspace
- name: '@deepseek-ai/dsh-tool-document'
  config:
    workspaceRoot: /path/to/workspace
```

### 工具

| Tool | Arguments | Behavior |
|---|---|---|
| `read_pdf` | `file_path`, `pages?` | 提取所选页面的文本（页码、`start-end` 范围,或以逗号分隔的混合；省略则读取全部页面）以及文档总页数 |
| `read_notebook` | `file_path` | 按顺序返回每个单元格 —— 类型、拼接后的来源,以及（代码单元格）渲染后的输出；超大输出会被截断并标记 |

### 配置

| Key | Default | Meaning |
|---|---|---|
| `workspaceRoot` | `process.cwd()` | 两个工具都将读取限制在此根目录内；解析后的路径超出范围——包括通过根目录内指向外部的符号链接/联接点（junction）——将以 `DOCUMENT_PATH_OUTSIDE_WORKSPACE` 拒绝 |
| `maxFileBytes` | `33554432`（32 MiB） | 任一工具读入内存的整个文件的字节上限（含端点）；同时也限制 PDF 内容流解压后的大小,因此高压缩比的 `FlateDecode` 流无法触发无上限的内存分配 |
| `maxOutputChars` | `4000` | 单个渲染后笔记本单元格输出在截断前的字符上限（含端点） |
| `maxTextChars` | `200000` | `read_pdf` 按页码升序拼接所选页面文本后,在截断前的字符上限（含端点） |

### PDF 支持

`read_pdf` 实现了一个最小化的内置提取器 —— 本工作区未引入任何成熟的 PDF 库（`pdfjs`/`pdf-parse`/`unpdf`）。它支持单版本、纯文本 PDF,其页面文本位于 `Tj`/`TJ`/`'`/`"` 内容流文本显示操作符中（字面量字符串 `(...)` 与十六进制字符串 `<...>` 操作数均可解码）,内容流可以是未压缩的,也可以是 `FlateDecode` 压缩的。它不解析交叉引用表（对象通过扫描全文中的 `N 0 obj … endobj` 找到,因此能容忍陈旧或缺失的 xref）,也不处理加密、对象流、交叉引用流或 `ToUnicode` CMap —— 参见[已知限制](#known-limitations-and-deferred-work)。

### 失败与恢复

失败会携带本包自有的 `DocumentError` 代码：`DOCUMENT_EMPTY_PATH`、`DOCUMENT_NOT_FOUND`、`DOCUMENT_NOT_REGULAR_FILE`、`DOCUMENT_PATH_OUTSIDE_WORKSPACE`（两个工具共用）；`PDF_PARSE_FAILED`、`PDF_UNSUPPORTED_FILTER`、`PDF_PAGE_RANGE_INVALID`、`PDF_PAGE_RANGE_OUT_OF_RANGE`（`read_pdf`）；`NOTEBOOK_PARSE_FAILED`（`read_notebook`，涵盖 JSON 格式错误以及笔记本不符合本包所理解的 nbformat 单元格/输出结构这两种情况）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>Implementation internals — click to expand</summary>

本节解释这两个工具背后的设计决策,并指向实现它们的代码；可观察行为已在 [使用本包](#use-this-package) 中完整覆盖。

### 设计理念

两个工具都是只读的,限制在 `workspaceRoot` 内,并且不依赖任何其他能力接缝 —— 没有附件存储（与 `read_image` 不同）、没有沙箱控制器、也不要求会话 cwd。`ctx.fs` 后端会解析路径,但并非都会限制路径（裸本地后端只是一个解析默认值,而非隔离边界）,因此 `src/workspace.ts` 在读取任何字节之前,显式地针对配置的根目录强制执行隔离。该检查比较的是**规范化**身份（`ctx.fs.processPath`,即 realpath）,而不是按原样拼写的 `displayPath`——根目录内部指向外部的符号链接或联接点目录同样会被拒绝,这与 `@deepseek-ai/dsh-fs-sandbox` 的 `checkedTarget` 为自身防护施加的检查属于同一类。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、默认值、上限校验、工具组合 |
| [`src/workspace.ts`](src/workspace.ts) | 共享的路径解析、工作区隔离、普通文件校验 |
| [`src/pdf.ts`](src/pdf.ts) | `read_pdf`：内置 PDF 对象扫描器、页面树遍历、内容流文本提取器、页面选择器解析 |
| [`src/notebook.ts`](src/notebook.ts) | `read_notebook`：nbformat 单元格/输出解析、ANSI 转义剥离、输出截断 |
| [`src/error.ts`](src/error.ts) | `DocumentError` —— 在面向模型的消息之外携带一个稳定的 `code` |
| [`src/types.ts`](src/types.ts) | 输出值类型（仅类型） |

### PDF 提取器支持的子集

对象通过扫描全文中的 `N 0 obj … endobj` 找到,而不是解析交叉引用表,因此陈旧或缺失的 xref（在简单粗暴的编辑之后很常见）不会阻塞提取。页面树从 `/Catalog` 的 `/Pages` 根节点开始,沿 `/Kids` 深度优先遍历,收集叶子 `/Page` 对象；每个页面的 `/Contents` 流（可以有多个）会被解码（通过 `node:zlib` 处理 `FlateDecode`,或原样透传未过滤的内容）,并扫描其中的 `Tj`/`TJ`/`'`/`"` 文本显示操作符 —— 字面量字符串 `(...)` 与十六进制字符串 `<...>` 操作数均可解码为文本 ——,`Td`/`TD`/`T*` 被视为换行,`BT`/`ET` 括起一个文本对象。其余所有操作符 —— 字体、颜色、图形状态、定位 —— 都不产生效果。`FlateDecode` 流解压后的大小受 `maxFileBytes` 限制（`inflateSync` 的 `maxOutputLength`,会提前中止展开而不是先分配完整输出）,因此高压缩比的流无法触发无上限的内存分配；所选页面拼接后的文本则另受 `maxTextChars` 限制。

### 笔记本输出渲染

`execute_result`/`display_data` 输出优先使用 `text/plain`；如果没有,则只标注第一个其他 mime 类型而不展示内容（如 `[image/png output omitted]`）。`error` 输出将 `ename: evalue` 与剥离了 ANSI SGR 转义序列的回溯信息拼接在一起。`stream` 输出按原样拼接其 `text` 字段。每个渲染后的输出都以 `maxOutputChars` 为上限,并附带一个准确说明被截去多少字符的标记 —— 绝不静默截断。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-document)中为 `read_pdf` 与 `read_notebook` 生成的 schema 说明了 `pages` 选择器语法与截断行为；插件挂载后两个工具会无条件注册。

#### Token 影响

只要工具可见,每次请求都有固定的 schema 开销。

#### KV Cache 影响

只要工具可见性与定义未变,前缀保持稳定。注册生命周期或作用域限制的变化可能会使从第一个变化的 schema token 起的复用失效。

### 结果与错误

#### 模型看到的内容

`read_pdf` 返回 `<path>`/`<type>pdf</type>`/`<content>`,其中包含 `totalPages` 以及每个所选页面在 `--- page N ---` 标题下的内容。`read_notebook` 返回相同的信封结构,`<type>notebook</type>`、`cellCount`,每个单元格在 `--- cell N (type) ---` 标题下,其输出以 `[output_type]` 标注。被截断的输出或页面以 `... [truncated N more characters]` 结尾；当拼接文本被截断时,`read_pdf` 的结构化结果还会携带一个顶层的 `truncated: true`,并丢弃截断点之后的所有页面。失败会被规范化为 `Error: <message>`,并携带一个稳定的 `DocumentError` 代码（`DOCUMENT_*`、`PDF_*`,或 `NOTEBOOK_PARSE_FAILED`）,供按失败类型分支处理的调用方使用。

#### Token 影响

受 `maxFileBytes`（提取前的整个文件,以及 PDF 内容流解压后的大小）、`maxTextChars`（`read_pdf` 所选页面拼接后的文本）与 `maxOutputChars`（每个笔记本输出）限制；调用及保留的结果会一直留在历史记录中,直到被压缩。

#### KV Cache 影响

仅追加；新出现的内容跟在可复用的请求前缀之后,不会使已有的 KV 缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **未引入成熟的 PDF 库** —— `read_pdf` 运行一个最小化的内置提取器,而非 `pdfjs`/`pdf-parse`/`unpdf`。它不解析交叉引用表,也不处理加密、对象流、交叉引用流或 `ToUnicode` CMap；使用非 Latin-1 兼容简单字体的文本,或扫描版/纯图像 PDF 中的文本,会返回空页面文本而不是报错。一旦本工作区引入了真正的提取器库,替换它将是本包内部一项独立的后续工作。
- **`TJ` 字距数字永远不会变成空格** —— `TJ` 数组中的数值操作数（字形间定位）会被丢弃而不是转换为空白字符,因此同一个 `TJ` 数组中相邻且没有显式空格字符的两个字符串在提取文本中会连在一起。
- **`read_notebook` 要求严格的 nbformat 4 单元格/输出结构** —— 无法识别的 `cell_type`/`output_type`,或缺失必需字段,会使整次读取以 `NOTEBOOK_PARSE_FAILED` 失败,而不是跳过出问题的单元格；不支持更早的 nbformat 版本以及 nbformat 4 四种类型之外的厂商专有输出类型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This model-facing tool pair has no independent lifecycle stream; it registers into the mounted `ctx.tools` runtime and holds no state of its own.
