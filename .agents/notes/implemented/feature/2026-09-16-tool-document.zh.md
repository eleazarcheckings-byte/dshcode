# Agent Note: read_pdf 与 read_notebook —— Claude Code 能原生读取的文件类型

Status: implemented

[English](2026-09-16-tool-document.md) | 中文

## Problem

Claude Code 能原生读取 PDF 和 Jupyter 笔记本文件；本 harness 此前没有对应能力 —— 模型被要求查看 PDF 或 `.ipynb` 文件时,没有任何工具能打开这两种格式,只有来自 `dsh-tool-fs`、仅支持 UTF-8 的 `read` 工具。

## Decision

新增包 `packages/fs/tool-document`（`@deepseek-ai/dsh-tool-document`）,沿用 `dsh-tool-fs` 读取类工具的形态（类似 `resolveRegularReadTarget` 的路径解析、`ctx.fs.readBytes` 字节上限、`fs/observed` 事件），但独立成包：仅注入 `['tools', 'fs']`,不依赖附件存储、沙箱或会话服务,并自行强制执行 `workspaceRoot` 隔离（`src/workspace.ts`）,因为 `ctx.fs` 后端会解析路径但并非都会限制路径。

`read_notebook` 直接解析 nbformat 4 JSON —— 按顺序列出单元格、拼接来源,并渲染输出（`stream`/`execute_result`/`display_data`/`error`,优先使用 `text/plain`,回溯信息剥离 ANSI）,并有 `maxOutputChars` 上限,超限时附加一个准确说明截去多少文本的标记。

`read_pdf` 需要一个文本提取器,而本工作区未引入任何此类库（已检查：`node_modules` 下没有 `pdfjs*`/`pdf-parse*`/`unpdf*`）。按照任务书中的兜底方案,它实现了一个最小化的内置提取器,而不是让该工具留空：通过扫描全文中的 `N 0 obj … endobj` 找到对象（不解析 xref）,页面树从 `/Catalog` 经 `/Pages`/`/Kids` 遍历,每个页面的内容流 —— `FlateDecode`（通过 `node:zlib`）或未压缩 —— 会被扫描以提取 `Tj`/`TJ` 文本显示操作符,`Td`/`TD`/`T*` 视为换行。`pages` 选择器（`"2"`、`"2-4"`、`"1,3-5"`）可缩小读取范围；超出范围或格式错误的选择器会以具名的 `DocumentError` 代码（`PDF_PAGE_RANGE_OUT_OF_RANGE` / `PDF_PAGE_RANGE_INVALID`）明确失败,而不是静默截断。

## Alternatives considered

**添加 PDF 库依赖（`pdfjs-dist`、`pdf-parse`、`unpdf`）。** 本次任务已否决：任务书禁止安装新依赖（`pnpm install` 不由本单元执行）,且 `node_modules` 中未预先存在此类库。内置提取器刻意保持狭窄,而不是重新实现一个通用 PDF 渲染器 —— 待工作区引入真正的库后,替换它将是一项独立的后续工作（已在 `integration_needs` 中标记）。

**仅信任已挂载的 `ctx.fs` 后端来限制路径。** 已否决：`LocalFileSystem.resolve` 的文档明确说明它「是一个解析默认值,而非隔离边界」—— 它会解析真实路径,但不会拒绝逃出其配置 `cwd` 的路径。`src/workspace.ts` 的 `resolveWorkspaceDocument` 为两个工具都增加了显式的 `workspaceRoot` 隔离检查,在任何读取之前就以 `DOCUMENT_PATH_OUTSIDE_WORKSPACE` 拒绝。

**正确解析 PDF 交叉引用表。** 对这个最小化提取器而言已否决：陈旧或缺失的 xref（在简单编辑之后很常见,且与扫描式方案无关）本会阻塞整个提取；直接扫描 `N 0 obj … endobj` 正是真实阅读器兜底恢复路径所做的事,对于本工具面向的单版本、非加密 PDF 已经足够。

## Consequences

只要在 `ctx.fs` 后端之后组合本包,`ctx.tools` 就会获得 `read_pdf` 与 `read_notebook`,无需其他能力接缝。PDF 提取器的已知缺口（不支持交叉引用/对象流/加密、不支持 `ToUnicode` CMap、扫描版/纯图像 PDF 返回空文本、`TJ` 字距数字不会变成空格）都记录在包 README 的已知限制中,而不是被静默地错误处理。`docs/tool-catalog.md` 需要一次 `doc-sync` 重新生成以纳入这两个新工具的 schema,根级 `tsconfig.host.json`/`tsconfig.client.json` 的项目引用以及任何 bundle/preset 行都是本单元不会自行添加的集成项（已在 `integration_needs` 中跟踪）。
