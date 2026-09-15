---
kind: feature
date: 2026-09-15
cell: C10a-site-tools
scope: 引擎 (G:/My Drive/Projects/mac/active/izzy-design) + 部署镜像输出
---

# saturnai.tools 前台：统一的视觉语言、实时试用台、真实回执

[English](2026-09-15-saturnai-tools-front.md) | 中文

## 摘要

访客在 `saturnai.tools` 上点击三次，就会看到三种不同的视觉语言。现在只有一种，
而且承载它的正是产品真正输出的东西——判定（verdict）。

## 动手之前先证明来源

| 已部署页面 | 改动前由什么生成 | 现在由什么生成 |
|---|---|---|
| `/` | `izzyawake-deploy/design/home/index.html`，手工编辑；`middleware.js` 的 `HOST_MAP["saturnai.tools"].root = "/design/home/"` | `E/site/home.html` → `E/dist/home/` → 镜像 |
| `/design/` | 由 `E/build.mjs` 从 `E/viewer.template.html` 生成的 `E/dist/index.html` | 源文件不变，版面重做 |
| `/design/connect/` | `izzyawake-deploy/design/connect/index.html`，手工编辑 | `E/site/connect.html` → `E/dist/connect/` → 镜像 |

证据：`curl https://saturnai.tools/` 返回 13,419 字节，与镜像中的
`design/home/index.html` 逐字节一致；`middleware.js:66-72` 带有该 `HOST_MAP`；
`dist/index.html` 与 `design/index.html` 均为 640,080 字节且修改时间相同。Drive 上的
`dev-site/design` 副本是过期的（home 为 8,835 字节，线上为 13,419 字节），这说明持有
线上真相的是部署镜像而非 Drive，也说明 home 与 connect 此前根本没有引擎源文件。

## 改了什么

- **`E/site/`** 是新增目录，现在是产品前台的源：`saturn.css`（统一的视觉语言）、
  `home.html` + `home.js`、`connect.html` + `connect.js`、两款自托管字体，以及
  `receipts.json`。
- **`E/site-build.mjs`** 将它们渲染进 `dist/home`、`dist/connect`、`dist/assets`，
  再把逐字节副本镜像到部署目录。离线且确定：连续两次构建产出完全相同的字节。
- **`E/build-receipts.mjs`** 是唯一联网的步骤。它在无头 Chrome 中渲染引擎自身的
  评审固件，在其中运行 `collect-evidence.js` v2，把测量结果 POST 到
  `https://saturnai.tools/api/design/call` `{"name":"review"}`，并把返回的判定写入
  `site/receipts.json`。证据区逐字渲染这些判定——一个 PASS 和一个 REJECT，连同各自的
  评分行与证据行。
- **`E/viewer.template.html`** 采用共享的 token 与字体，用事实清单版面取代营销版面，
  把统计条与分类标签堆折叠到搜索框下方的默认关闭的展开块中，并以 -18° 绘制标记环。
- **`E/llms.txt`** 现在是已部署的 24,288 字节版本：引擎成为唯一权威。

## 机制

判定卡。一个 `PASS`/`REVISE`/`REJECT` 印章，打在 -18° 的标记环内，下面是它实测的证据行
与六项评分。环会自行绘制（`pathLength` + `stroke-dashoffset`），字样在 200 毫秒后落下
——两段动效都在陈述同一个事实：这个判定是挣来的。同一个对象出现在 `/`（两份真实回执）
与 `/design/connect/`（复印的那份 PASS）。

## 已知限制与后续工作

- 有四个高端技术栈槽位是**声明而非证明**，回执中如实写明：`framework`（不用 Astro，
  引擎输出纯 HTML）、`images`（不发布任何位图，唯一的图形是内联 SVG）、`a11y-gate`
  （尚无 CI 对该静态镜像跑 axe-core）、`cwv-gate`（真实流量才有现场指标）与 `audit`
  （本次会话未跑 Lighthouse——宁可声明也不冒充，因为为没人跑过的审计背书，正是这份回执
  要防止的伪造）。
- 证据覆盖率为 89%：`surfaces` 组为空，因为该设计全程不用圆角与阴影。这是设计本身，
  不是遗漏。
- 针对本地完整素材库运行 `grade-page.mjs` 时，一个素材卡缺陷会阻断任何站点页面的 PASS
  （见报告的 `integration_needs`）；而验收标准所指的托管评审返回 PASS。

## 修复轮次——随包分发的 Commit Mono 许可证（2026-09-15）

第一次构建把 Commit Mono 放在一份空白的 SIL OFL 1.1 模板下分发：没有版权声明、没有署名，
也没有提到上游仓库所带的 MIT `LICENSE`。上游确实存在两种互相矛盾的声明，因此两者都经过
核验，现在也都随包分发：

- 字体二进制在自己的 OpenType `name` 表中声明 OFL 1.1——name ID 13 与 14，直接从
  `commit-mono-400/500.woff2`（`Version 1.143`）中读出；
- `github.com/eigilnikolajsen/commit-mono` 带有一份 1,073 字节的 `LICENSE`，GitHub 的
  license API 报告其 SPDX 为 `MIT`（blob `c288df41…`）。

`assets/fonts/LICENSE-commit-mono.txt`（8,188 字节）现在以 OFL 第 1 条要求的版权声明
开头，指明它所管辖的确切二进制文件与版本，注明每项声明的读取出处与日期，并逐字复制两份
许可证文本。文件名不作任何断言，因为没有哪一个许可证名称是完全成立的。
`test/site-fonts-license.test.mjs` 每次运行都会解析随包的 woff2，一旦被替换的二进制与
旁边的文本不符即失败。

## 开发备注

`node build-receipts.mjs` 需要网络与系统 Chrome；`node build.mjs` 两者都不需要。
切勿在部署镜像中手工编辑 `design/home`、`design/connect` 或
`design/assets/saturn.css`——它们是构建产物，下一次构建会覆盖。
