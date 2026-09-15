# Agent Note：只保留一条桌面发布通道，重复的一条已下线

Status: implemented

[English](2026-09-15-desktop-release-lane.md) | 中文

## 问题

此前某个修复轮构建单元新增了 `.github/workflows/desktop-release.yml`，作为第二条
由标签触发的发布 workflow，理由是认为复用 `.github/workflows/desktop.yml` 的
`desktop-v*` 标签会导致两个 workflow 在同一次推送上同时触发，并互相争抢同一个
`gh release create`。但 `desktop.yml` 本身已经在 `desktop-v*` 标签上完整构建了
macOS（`macos-15` arm64、`macos-15-intel` x64）和 Windows（`windows-2025` x64）、
运行了 Windows 目录选择器和 Electron 打包启动的冒烟测试、生成了 `SHA256SUMS.txt`
并创建了 GitHub release——这正是第二条通道在不同标签命名空间
（`desktop-release-v*`）下重复的同一份工作，而且覆盖面严格更少（没有冒烟测试）。
应该存在且被记录的是一条发布通道，而不是两条做同一件事的通道。

## 决定

下线重复的一条：`git rm .github/workflows/desktop-release.yml`。保留
`desktop.yml` 作为唯一的发布路径——除了标签前缀不同之外，第二条通道并没有添加
任何 `desktop.yml` 缺失的东西。重写 `apps/desktop/RELEASE.md`，直接围绕
`desktop.yml` 编写文档：它精确的 runner 标签（`macos-15`、`macos-15-intel`、
`windows-2025`）、`package`/`release` 两个 job 的划分、`desktop-v*` 标签触发条件、
各类产物分别落在何处（workflow artifact 还是 GitHub Release）、未签名构建的用户
体验（Gatekeeper/SmartScreen 警告）、Apple 开发者（每年 99 美元）和 Windows 代码
签名（每年 70–400 美元）作为 Eleazar 需要把关的支出（Gate），以及日后要把哪些
secret（`CSC_LINK`、`CSC_KEY_PASSWORD`、notarytool 凭证）接入 `desktop.yml`，
还有本地 Mac 构建的交接方式 `scripts/build-mac.sh`（比 `dshcode/` 高一级）——
该脚本未做改动，因为其构建命令已经和 `desktop.yml` 一致（`pnpm install
--frozen-lockfile`、`pnpm run build`、`pnpm --filter @dshcode/desktop run
dist:mac:$arch`），只更新了脚本头部注释，使其不再指向已删除的 workflow。

在重申"CI 分钟数免费"这一结论之前，重新核实了仓库可见性：
`gh repo view eleazarcheckings-byte/dshcode`（`fork` 远程）返回
`visibility: PUBLIC`。

## 考虑过的替代方案

**保留两条通道，之后再协调。** 已否决：此前的记录已经把这标记为待解决的问题，
并写入了 `integration_needs`；但仔细检查后发现根本没有需要协调的地方——第二条
通道没有增加任何 `desktop.yml` 缺失的覆盖，保留它纯粹是重复劳动和文档蔓延
（两份 README、两个标签前缀、构建矩阵一变要改两处）。

**把 `desktop-release.yml` 的校验和步骤移植进 `desktop.yml`，其余部分丢弃。**
没有必要：`desktop.yml` 的 `release` job 在调用 `gh release create` 之前已经
执行了 `sha256sum * > SHA256SUMS.txt`——这个替代方案想"新增"的校验和步骤本来
就已经存在。

**现在就签名并公证。** 和此前一样被否决：目前没有配置 Apple 开发者账号或代码
签名证书，配置任何一个都属于需要把关的支出（Gate）——无论技术上是否就绪，都
超出本单元的范围。

## 后果

`desktop.yml` 这一个 workflow 就是完整的桌面发布路径：向公开的 `fork` 远程
（`eleazarcheckings-byte/dshcode`）推送一个 `desktop-v*` 标签，它就会构建、
冒烟测试、生成校验和并发布 GitHub release，且不产生任何基础设施成本。
`RELEASE.md` 完全按照 workflow 文件中实际写的内容记录了这条路径，外加本地
Mac 构建的交接方式，以及启用代码签名将来需要的花费和配置。已经没有第二条
通道需要协调了。
