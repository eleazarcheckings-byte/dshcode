# Agent Note: saturnai.tools 前台：统一的视觉语言、实时试用台、真实回执

Status: implemented

[English](2026-09-15-saturnai-tools-front.md) | 中文

## 问题

访客在 `saturnai.tools` 上点击三次，就会看到三种不同的视觉语言：`/`、`/design/` 与 `/design/connect/` 各自看起来像不同的产品。动手之前先证明来源，原因如下：

| 已部署页面 | 改动前由什么生成 | 现在由什么生成 |
|---|---|---|
| `/` | `izzyawake-deploy/design/home/index.html`，手工编辑；`middleware.js` 的 `HOST_MAP["saturnai.tools"].root = "/design/home/"` | `E/site/home.html` → `E/dist/home/` → 镜像 |
| `/design/` | 由 `E/build.mjs` 从 `E/viewer.template.html` 生成的 `E/dist/index.html` | 源文件不变，版面重做 |
| `/design/connect/` | `izzyawake-deploy/design/connect/index.html`，手工编辑 | `E/site/connect.html` → `E/dist/connect/` → 镜像 |

证据：`curl https://saturnai.tools/` 返回 13,419 字节，与镜像中的 `design/home/index.html` 逐字节一致；`middleware.js:66-72` 带有该 `HOST_MAP`； `dist/index.html` 与 `design/index.html` 均为 640,080 字节且修改时间相同。Drive 上的 `dev-site/design` 副本是过期的（home 为 8,835 字节，线上为 13,419 字节），这说明持有 线上真相的是部署镜像而非 Drive，也说明 home 与 connect 此前根本没有引擎源文件：三个页面 中有两个是直接在部署镜像里手工编写的，引擎（`G:/My Drive/Projects/mac/active/izzy-design`） 里没有任何东西生成它们。

## 决定

引擎（`E` = `G:/My Drive/Projects/mac/active/izzy-design`）现在是这三个表面的唯一权威源， 部署镜像只是构建产物。此决定在 cell `C10a-site-tools` 中构建完成，范围限定为该引擎及其写入的 部署镜像输出：

- **`E/site/`** 是新增目录，现在是产品前台的源：`saturn.css`（统一的视觉语言）、 `home.html` + `home.js`、`connect.html` + `connect.js`、两款自托管字体，以及 `receipts.json`。
- **`E/site-build.mjs`** 将它们渲染进 `dist/home`、`dist/connect`、`dist/assets`， 再把逐字节副本镜像到部署目录。离线且确定：连续两次构建产出完全相同的字节。
- **`E/build-receipts.mjs`** 是唯一联网的步骤。它在无头 Chrome 中渲染引擎自身的 评审固件，在其中运行 `collect-evidence.js` v2，把测量结果 POST 到 `https://saturnai.tools/api/design/call` `{"name":"review"}`，并把返回的判定写入 `site/receipts.json`。证据区逐字渲染这些判定——一个 PASS 和一个 REJECT，连同各自的 评分行与证据行。
- **`E/viewer.template.html`** 采用共享的 token 与字体，用事实清单版面取代营销版面， 把统计条与分类标签堆折叠到搜索框下方的默认关闭的展开块中，并以 -18° 绘制标记环。
- **`E/llms.txt`** 现在是已部署的 24,288 字节版本：引擎成为唯一权威。

## 机制

判定卡。一个 `PASS`/`REVISE`/`REJECT` 印章，打在 -18° 的标记环内，下面是它实测的证据行 与六项评分。环会自行绘制（`pathLength` + `stroke-dashoffset`），字样在 200 毫秒后落下 ——两段动效都在陈述同一个事实：这个判定是挣来的。同一个对象出现在 `/`（两份真实回执） 与 `/design/connect/`（复印的那份 PASS）。

## 已知限制与后续工作

- 有四个高端技术栈槽位是**声明而非证明**，回执中如实写明：`framework`（不用 Astro， 引擎输出纯 HTML）、`images`（不发布任何位图，唯一的图形是内联 SVG）、`a11y-gate` （尚无 CI 对该静态镜像跑 axe-core）、`cwv-gate`（真实流量才有现场指标）与 `audit` （本次会话未跑 Lighthouse——宁可声明也不冒充，因为为没人跑过的审计背书，正是这份回执 要防止的伪造）。
- 证据覆盖率为 89%：`surfaces` 组为空，因为该设计全程不用圆角与阴影。这是设计本身， 不是遗漏。
- 针对本地完整素材库运行 `grade-page.mjs` 时，一个素材卡缺陷会阻断任何站点页面的 PASS （见报告的 `integration_needs`）；而验收标准所指的托管评审返回 PASS。

## 修复轮次——随包分发的 Commit Mono 许可证（2026-09-15）

第一次构建把 Commit Mono 放在一份空白的 SIL OFL 1.1 模板下分发：没有版权声明、没有署名， 也没有提到上游仓库所带的 MIT `LICENSE`。上游确实存在两种互相矛盾的声明，因此两者都经过 核验，现在也都随包分发：

- 字体二进制在自己的 OpenType `name` 表中声明 OFL 1.1——name ID 13 与 14，直接从 `commit-mono-400/500.woff2`（`Version 1.143`）中读出；
- `github.com/eigilnikolajsen/commit-mono` 带有一份 1,073 字节的 `LICENSE`，GitHub 的 license API 报告其 SPDX 为 `MIT`（blob `c288df41…`）。

`assets/fonts/LICENSE-commit-mono.txt`（8,188 字节）现在以 OFL 第 1 条要求的版权声明 开头，指明它所管辖的确切二进制文件与版本，注明每项声明的读取出处与日期，并逐字复制两份 许可证文本。文件名不作任何断言，因为没有哪一个许可证名称是完全成立的。 `test/site-fonts-license.test.mjs` 每次运行都会解析随包的 woff2，一旦被替换的二进制与 旁边的文本不符即失败。

## 开发备注

`node build-receipts.mjs` 需要网络与系统 Chrome；`node build.mjs` 两者都不需要。 切勿在部署镜像中手工编辑 `design/home`、`design/connect` 或 `design/assets/saturn.css`——它们是构建产物，下一次构建会覆盖。

## 曾考虑的替代方案

**继续在部署镜像里手工编辑，而不是由引擎生成。** 这正是 `/` 与 `/design/connect/` 此前的做法，而它本身就是问题所在，不是解法：两个手工编写的页面没有共享源，各自 漂向了自己的视觉语言，而且没有任何东西能发现这种漂移，因为引擎里根本没有生成它们的 代码。不予采纳，因为部署镜像正是必须停止手工编写的那一层，三个表面才能收敛到同一种 视觉语言。

**引入 Astro 以证明（而非声明）`framework` 高端技术栈槽位。** SPEC §3 C10a 明确授权 声明该槽位而非证明它，且引擎纯 HTML、零客户端框架的构建保持离线且确定（连续两次构建 产出完全相同的字节）。为了把一个已如实声明的槽位改成已证明的槽位而引入框架，会为这个 静态前台平添一项本不需要的构建依赖与运行时，而回执本可以诚实地说明尚未尝试。

**把随包分发的 Commit Mono 许可证文件命名为 `-MIT` 或 `-OFL`。** 不予采纳：随包分发的 二进制文件在自己的 OpenType `name` 表中声明 OFL 1.1，而上游仓库的 `LICENSE` 文件却是 MIT——这是两条真实存在且相互矛盾的上游声明。无论用哪个名字，都会断言一个证据并不完全 支持的说法，因此文件名保持中性（`LICENSE-commit-mono.txt`），正文逐字复制两份许可证 文本并各自注明来源。

## 后果

维护者此后通过编辑 `E/site/*` 并运行 `node build.mjs` 来改动产品前台；在部署镜像里 手工编辑 `design/home`、`design/connect` 或 `design/assets/saturn.css` 不再有任何 持久效果——这些路径都是构建产物，下一次构建会覆盖任何手工改动。渲染进 `/` 与 `/design/connect/` 的回执，只有在联网且有系统 Chrome 的情况下运行 `node build-receipts.mjs` 才会重新生成；`node build.mjs` 本身保持离线，因此在再次运行那个 联网步骤之前，`site/receipts.json` 会一直保留它上一次记录的判定。部署镜像（镜像根目录 下的 `design/**`）现在纯粹是生成产物；四个已声明的高端技术栈槽位（`framework`、 `images`、`a11y-gate`、`cwv-gate`、`audit`）在分别完成框架迁移、发布位图、CI 跑通 axe-core、取得真实现场 CWV 流量、或跑过一次 Lighthouse 审计之前，将继续保持声明而非 证明的状态。
