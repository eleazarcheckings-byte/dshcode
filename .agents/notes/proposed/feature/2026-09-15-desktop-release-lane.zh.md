# Agent Note：桌面发布通道，未签名、由标签触发

Status: proposed

[English](2026-09-15-desktop-release-lane.md) | 中文

## 问题

`apps/desktop` 已经配置好了 electron-builder（`electron-builder.yml`），每个目标平台也都有对应的
`dist:mac:*` / `dist:win:x64` 脚本，但没有任何机制把 `desktop-v*` 标签和实际的 GitHub release 关联起来：
此前没有可重复的方式能把 Saturn AI 的 macOS 或 Windows 构建交给别人——只能靠维护者手动运行打包脚本、
手动上传文件，也没有任何文档说明代码签名要花多少钱、什么时候该启用。

## 决定

新增 `.github/workflows/desktop-release.yml`：在推送 `desktop-v*` 标签时，一个三路矩阵
（`macos-14` arm64、`macos-13` x64、`windows-latest`）依次执行 `corepack enable`
（读取根目录 `packageManager: pnpm@11.7.0` 的锁定版本）、`pnpm install --frozen-lockfile`、
`pnpm run build`，再运行对应的 `pnpm --filter @dshcode/desktop run dist:*` 脚本，把生成的
`.dmg`/`.zip`/`.exe` 上传为 workflow artifact；后续任务下载全部三份产物，生成
`SHA256SUMS.txt`，再通过 `gh release create` 把它们一并附加到 GitHub release。
在 workflow 级别设置了 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免任何 runner 上偶然存在的钥匙串
状态产生签名不一致的构建；发布本身按设计是未签名的。`apps/desktop/RELEASE.md` 记录了确切的命令、
未签名构建的用户体验（Gatekeeper 与 SmartScreen 的警告），以及下一步需要的 Apple 开发者计划会员
（约每年 99 美元）和 Windows 代码签名证书（约每年 70–400 美元）各自的花费——两者都标记为需要
把关的支出（Gate），而不是这条发布通道自行开通的东西。仓库根目录下的 `scripts/build-mac.sh`
（比 `dshcode/` 高一级）在真实 Mac 上手动本地构建时复现了相同的步骤。

在假设 CI 分钟数免费之前先核实了仓库可见性：`gh repo view eleazarcheckings-byte/dshcode`
返回 `visibility: PUBLIC`，因此这些 runner 分钟数不产生任何费用。

## 考虑过的替代方案

**扩展现有的 `.github/workflows/desktop.yml`**，而不是新增一个文件。此次改动未采纳：
`desktop.yml` 已经在 `macos-15` / `macos-15-intel` / `windows-2025` 上通过 `pnpm/action-setup`
构建，并附带本次任务未要求的、Electron 专属的冒烟测试与目录选择器测试，不应该在未获授权的情况下
悄悄丢弃或重复实现这些逻辑。任务简报要求的是一个新的、单独命名的 workflow；如何协调两者
（下线其中一个，或合并约定）属于维护者层面的集成决策，不是构建单元可以单方面决定的默认行为——
已经在本次会话的 `integration_needs` 中标出，而非在此处擅自解决。

**现在就签名并公证。** 未采纳：目前没有配置 Apple 开发者账号或代码签名证书，而配置这些属于
需要把关的支出（Gate）——无论技术上是否就绪，都超出本单元的范围。

## 后果

维护者只需推送一个标签，就能发起一次桌面发布；产物和校验和会自动作为 GitHub release 落地，
在公开仓库上不产生任何基础设施成本。任何打开该 release 的人都会看到未签名的构建，并且根据
RELEASE.md 会知道 Gatekeeper/SmartScreen 的警告是预期行为，不代表构建出了问题。并行存在的
`desktop.yml` workflow 仍然保留着不同的 runner 矩阵和额外的冒烟测试，两者尚未协调；在有人
合并或正式弃用其中一个之前，未来对任一发布通道的矩阵或脚本名称的改动都需要手动对照另一个检查。
