# Agent Note：桌面发布通道，未签名、由标签触发

Status: implemented

[English](2026-09-15-desktop-release-lane.md) | 中文

## 问题

`apps/desktop` 已经配置好了 electron-builder（`electron-builder.yml`），每个目标平台也都有对应的
`dist:mac:*` / `dist:win:x64` 脚本。`.github/workflows/desktop.yml` 已经把 `desktop-v*` 标签和
一整套冒烟测试关联到了 GitHub release，但那是唯一的这类通道，也没有任何文档说明代码签名要花多少钱、
什么时候该启用。这次改动新增了第二条更轻量的发布通道（带校验和的产物、不含冒烟测试、使用独立的标签
命名空间）以及缺失的成本/签名文档——不是因为此前完全没有机制把标签接到 release，而是因为修复轮的
复查（Mars，2026-09-15）发现：如果和 `desktop.yml` 共用 `desktop-v*` 标签，两个 workflow 会在同一次
推送上同时触发，并互相争抢同一个 `gh release create`，所以这条通道需要有自己的触发条件才能与
现有通道共存。

## 决定

新增 `.github/workflows/desktop-release.yml`：在推送 `desktop-release-v*` 标签时（与
`desktop.yml` 的 `desktop-v*` 使用不同的命名空间，因此两个 workflow 不会在同一个标签上同时触发），
一个三路矩阵（`macos-15` arm64、`macos-15-intel` x64、`windows-latest`）依次执行
`pnpm/action-setup@v4`（读取根目录 `packageManager: pnpm@11.7.0` 的锁定版本，采用与
`desktop.yml` 相同、已验证可行的方式，而不是裸的 `corepack enable`）、`pnpm install
--frozen-lockfile`、`pnpm run build`，再运行对应的 `pnpm --filter @dshcode/desktop run dist:*`
脚本，把生成的 `.dmg`/`.zip`/`.exe` 上传为 workflow artifact；后续任务下载全部三份产物，生成
`SHA256SUMS.txt`，再通过 `gh release create` 把它们一并附加到 GitHub release。在 workflow 级别
设置了 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免任何 runner 上偶然存在的钥匙串状态产生签名不一致
的构建；发布本身按设计是未签名的。`apps/desktop/RELEASE.md` 记录了确切的命令（推送到 `fork`
远程，即 `eleazarcheckings-byte/dshcode`——而不是第三方远程 `origin`）、未签名构建的用户体验
（Gatekeeper 与 SmartScreen 的警告）、为什么标签要和 `desktop.yml` 分开命名，以及下一步需要的
Apple 开发者计划会员（约每年 99 美元）和 Windows 代码签名证书（约每年 70–400 美元）各自的
花费——两者都标记为需要把关的支出（Gate），而不是这条发布通道自行开通的东西。仓库根目录下的
`scripts/build-mac.sh`（比 `dshcode/` 高一级）在真实 Mac 上手动本地构建时复现了相同的步骤。

在假设 CI 分钟数免费之前先核实了仓库可见性：`gh repo view eleazarcheckings-byte/dshcode`
（`fork` 远程）返回 `visibility: PUBLIC`，因此该远程上这些 runner 分钟数不产生任何费用。

## 考虑过的替代方案

**复用 `desktop.yml` 的 `desktop-v*` 标签。** 在修复轮复查证实了冲突之后被否决：两个 workflow
会在同一次推送上同时触发，都对同一个标签执行 `gh release create`，后完成的那个会直接失败
（或者 release 的标题/说明变成一场竞争）。使用独立的 `desktop-release-v*` 前缀就能彻底消除这个
冲突，且不需要改动超出本次改动范围的 `desktop.yml`。

**直接下线或合并进 `desktop.yml`。** 未在此处完成：`desktop.yml` 是本构建单元文件范围之外、
且仓库中其他并行工作也在涉及的既有 workflow。协调这两条通道（下线其中一个，或把目录选择器/
启动冒烟测试移植到另一个）属于维护者层面的决策，已经记录在 `RELEASE.md` 的"待解决问题"部分
和本次会话的 `integration_needs` 中，而非在此处擅自解决。

**现在就签名并公证。** 未采纳：目前没有配置 Apple 开发者账号或代码签名证书，而配置这些属于
需要把关的支出（Gate）——无论技术上是否就绪，都超出本单元的范围。

## 后果

维护者只需推送一个 `desktop-release-v*` 标签，就能发起一次带校验和的桌面发布；产物和
`SHA256SUMS.txt` 会自动作为 GitHub release 落地，在公开的 `fork` 远程上不产生任何基础设施成本，
也不会干扰既有的 `desktop.yml` 通道及其冒烟测试。任何打开该 release 的人都会看到未签名的构建，
并且根据 RELEASE.md 会知道 Gatekeeper/SmartScreen 的警告是预期行为。两条发布通道
（`desktop.yml` 与 `desktop-release.yml`）在用途上仍有重叠，尚未协调——RELEASE.md 的
"待解决问题"部分会持续跟踪，直到有维护者下线或合并其中一个。
