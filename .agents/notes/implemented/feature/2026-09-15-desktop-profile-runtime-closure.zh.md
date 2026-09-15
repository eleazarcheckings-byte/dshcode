# Agent Note: Desktop profile runtime dependency closure

Status: implemented

[English](2026-09-15-desktop-profile-runtime-closure.md) | 中文

## 问题

桌面运行时通过 CLI 应用包引用 profile bundle。如果依赖检查只发现 `packages/` 和 `vendor/`，遍历就会停在应用这一层，从而可能接受缺少 profile 插件必需对等依赖的桌面清单。此类遗漏通常要等仅含生产依赖的部署移除开发依赖后才会出现。

## 决策

[运行时闭包验证器](../../../../scripts/verify-runtime-closure.ts) 在包和 vendor 清单之外包含 `apps/*/package.json`。其依赖遍历到达 CLI 的 base 和 web bundle，再将每个可达工作区包的必需对等依赖与选定运行时清单进行核对。诊断明确指出该清单。[桌面清单](../../../../apps/desktop/package.json) 直接声明完整必需对等依赖集合，包括 Team、会话 API、模型、授权及原生工具提供器。

打包脚本在暂存前执行此验证器。回归夹具建立 desktop 到 CLI、bundle、plugin 的链条，确认缺少对等依赖会拒绝发布，而补充声明后同一依赖图可以通过。

## 考虑过的替代方案

**仅将新发现的包加入桌面清单。** 这会保留应用遍历缺口，使之后的 profile 变化继续绕过同一检查。

**依赖开发安装结果。** 工作区开发依赖可能使缺少的生产对等依赖看似存在。验证器必须在生产暂存前根据选定运行时清单进行检查。

## 影响

桌面检查覆盖生产 profile 依赖图，而不仅是外壳直接引用的包。它不能替代打包后的启动与交互检查，后者仍需验证可执行资源及实际插件激活。本地桌面发布的包版本独立于上游 CLI 家族递增。
