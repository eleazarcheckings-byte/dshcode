# Agent Note: SaturnBot 最小化后返回主应用

Status: implemented

[English](2026-09-15-saturnbot-minimize-to-harness.md) | 中文

## Problem

SaturnBot 是 Saturn AI 工作流中的管理窗口。最小化时将其放入单独的任务栏条目，会使它与启动入口分离。通过重新创建管理界面来恢复窗口会丢失本地草稿，而普通浏览器聚焦无法可靠地显示已被 Host 隐藏的 Electron 窗口。

## Decision

桌面端维护一个设置了 `skipTaskbar: true` 的 SaturnBot 子窗口。原生最小化会隐藏该窗口，显示并聚焦主应用。现有右上角启动按钮恢复保留的窗口，不触发导航，也不增加第二条 UI 栏。关闭子窗口仍会销毁它；下次启动时创建新的管理界面。

Preload 仅为此操作提供 `restoreSaturnBot(): Promise<boolean>`。主进程只接受主应用渲染进程的请求，恢复并聚焦存活的子窗口；没有子窗口时返回 `false`。浏览器客户端保留命名窗口聚焦路径。此桥接不授予通用窗口控制能力，也不改变工具权限。

此决策扩展[智能体消息界面](2026-09-14-saturnbot-agent-messenger.zh.md)，并保留其独立窗口组合方式。[主窗口托盘策略](../architecture/2026-08-14-desktop-tray-and-close-to-tray.zh.md)和[初始快照行为](../bug-fix/2026-09-15-saturnbot-initial-snapshot.zh.md)仍是独立决策。

## Alternatives considered

**普通任务栏最小化。** 它让操作系统任务栏成为返回管理界面的路径，而不是主应用中的启动按钮。

**在主应用内增加第二条最小化窗口栏。** 它与现有 SaturnBot 启动按钮重复，为同一窗口增加第二个管理入口。

**最小化时关闭并重新创建。** 它会丢弃按角色保留的本地草稿和当前检查状态。保留隐藏窗口可以保存两者。

## Consequences

最小化保留本地 UI 状态，并将主应用作为返回位置。隐藏的管理窗口会保留渲染进程内存，直到窗口关闭；后台 UI 刷新仍由可见性控制。Host 后台任务独立于窗口可见性，只要 Host 开启就会继续运行。草稿只存在于保留的窗口中，关闭该窗口后会丢失。
