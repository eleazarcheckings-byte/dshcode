---
description: "设置 → 远程：开启远程访问，查看设备所拨的地址与证书，显示配对二维码，并吊销已配对设备。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-remote-access

[English](README.md) | 中文

## 概述

一个设置页面，按顺序回答三个问题：远程访问是否开启、手机应拨什么地址与证书、哪些设备已经持有钥匙。配对码由浏览器依据主机铸造的载荷直接绘制——没有网络请求，也没有图像服务——并且在有人主动要求之前，它不会出现在屏幕上。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

浏览器入口先挂载由 `@saturnai/dsh-remote-access` 生成的 Remote 命名空间，再注册一个 `settings.section` 席位：id 为 `remote`，order 为 45，标签取自 `settings.remote` 词典。主机侧的 Loader 入口不执行任何行为。

页面在挂载时以及每次写操作之后读取主机状态，因此一次失败的调用会清空视图，而不是在早已关闭的监听上留下一盏过期的绿灯。开启访问、生成配对码、吊销设备是它执行的三种写操作；三者都经由 Remote 命名空间，且都不会被静默重试。

`./client` 导出 `encodeQr(text)` 与 `qrPathData(matrix)`，供任何需要绘制同一符号的界面使用：字节模式，版本 1 至 40，纠错等级 L 与 M，返回模块栅格与单条 SVG 路径。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

**二维码在此编码。** 配对码必须能由应用已经附带的 bundle 离线绘制，因此编码器是本包的一部分，而不是一个依赖：来自 ISO/IEC 18004 的容量与分块表、GF(256) 上的 Reed–Solomon、八种掩码图案及标准规定的罚分评估，以及各自 BCH 生成多项式下的格式信息与版本信息。符号选择先取能容纳内容的最小版本，随后在最多多花一个版本的前提下升级到等级 M——配对码只在手边扫描一次，因此在该界限内，尺寸比冗余更重要。测试套件将这些表与标准自身公布的容量、格式信息与对齐图案中心值逐项比对，并用一个独立于编码器编写的解码器把每一张完成的矩阵重新读出来。

**符号在任何主题下都不做深底浅码。** 扫描器需要的是对比度，因此符号在明暗两种主题下都保持浅色底与深色模块，不随表面反转。四周的卡片承载产品配色；符号本身承载数据。

**设备令牌永远不会变成文本。** 配对载荷只交给编码器，不交给别处——说明文字只显示标题、提示与过期时间。测试断言渲染容器的文本内容不包含该令牌。

**边界处只解包一次。** 生成式 Remote 把传输是否成功与取值分开报告（`{ ok, value }`）；直接提供的面则自行返回取值。`contracts.ts` 一次性归一化这两种形态，使其上层的每个调用方都只与领域值打交道。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [远程访问主机包](../../saturn/remote-access/README.zh.md) — 监听、配对契约与设备账本。
- [设置外壳](../ui-settings/README.zh.md) — 本页面所占据的插槽契约。
- [基础组件](../ui-primitives/README.zh.md) — 此处每个动作所用的按钮原子。

<a id="model-experience"></a>
## 模型体验

None, as this package only renders browser-side settings; it registers no tool, prompt section, or model-visible text.

#### KV Cache effect

无。该页面不构造任何模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **二维码编码器仅覆盖字节模式下的 L、M 两级。** 数字、字母数字与汉字模式以及 Q、H 等级均未实现，因为配对载荷是一段 JSON 字符串，其他场景并不需要。
- **页面不做轮询。** 它反映的是最近一次主机应答的状态，因此页面打开之后才失败的监听，只有在下一次操作或重新打开时才可见。
- **事件流不在此渲染。** 日志展示状态变更；实时审批与判定发往已配对设备，而不回流到这张卡片。
- **吊销“你正在使用的这台设备”不作区分。** 主机会记录这一点，但页面两种情况下显示相同的确认。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-saturn-remote-access.zh.md)涵盖配对契约，以及二维码编码器为何内置于本包。

</details>
