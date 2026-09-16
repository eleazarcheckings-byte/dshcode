---
description: "设置 → 账户：本机的 izzy.la 身份，以及针对 Saturn AI 桌面更新源的用户发起检查。"
kind: "package-reference"
---

# @saturnai/dsh-client-ui-settings-account

[English](README.md) | 中文

## 概述

一个设置页面，按顺序回答两个问题：这台机器是否已用 izzy.la 登录，以及是否发布了更新的 Saturn AI 安装包。缺少 OAuth 客户端、缺少桌面桥、尚未发布的 electron-updater 源，都是空状态。页面从不伪造已登录用户，也从不自动下载更新。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

浏览器入口注册一个 `settings.section` 席位：id 为 `account`，order 为 8，标签取自 `settings.account` 词典。主机侧的 Loader 入口不执行任何行为。

页面在挂载时通过桌面 preload 桥（`window.dshDesktop`）读取身份。桥不存在时——普通浏览器——该面返回未连接，原因为 `oauth-unavailable`。登录、退出、检查更新是它执行的三种写操作；三者都不会被静默重试，也都不安装更新。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

**身份是产品会话，不是 IdP Cookie。** izzy.la Accounts 是签发方（`https://izzy.la/api/auth/oauth2/authorize`）。本机在 `$DSH_HOME/account/session.json` 中保存 `{ connected, sub, email?, name? }`。`connected: true` 但没有 `sub` 的记录会塌缩为未连接，因此一份被植入的文件无法画出伪造用户。

**没有 Saturn AI 客户端就无法完成 OAuth。** SaturnDesign 已注册的客户端是另一个依赖方，会被忽略。在 `SATURN_AI_OAUTH_CLIENT_ID` 指向为此产品注册的客户端之前，登录停留在空的未连接状态。

**更新检查使用 electron-updater 的 GitHub 源。** 频道固定为 `eleazarcheckings-byte/dshcode`。`whitelonng/dshcode` 会被拒绝。检查是一个按钮。404 的 `latest.yml` 被报告为空源；没有该 YAML 但有更新 GitHub 标签时，报告为有新安装包、尚无自动更新源。不会下载任何内容。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [桌面壳](../../../apps/desktop/README.zh.md) — preload 桥、`app-update.yml` 与会话文件。
- [设置外壳](../ui-settings/README.zh.md) — 本页面所占据的插槽契约。
- [izzy.la Accounts](https://izzy.la/account/) — 身份提供方。

<a id="model-experience"></a>
## 模型体验

### 浏览器设置区块

#### 模型看到的内容

账户区块不产生任何模型可见内容。本页不发起任何模型请求，不持有对话上下文，也不注册任何面向模型的内容。

#### Token 影响

当前进程内为零。

#### KV Cache 影响

当前进程内无影响；本区块不会给任何提供方请求带来变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **在 izzy.la 上为此产品注册 OAuth 客户端并配上回环回调之前，授权码交换无法完成。** 登录会如实说明这一点，而不会假装已经登入。
- **GitHub 频道目前没有 `latest.yml`。** 检查更新会报告空源（或有新安装包但没有自动更新源），而不会自动下载。
- **本页是桌面端的面。** 在普通浏览器中会保持未连接，因为没有通向 `$DSH_HOME` 的 preload 桥。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-desktop-updater-and-account.zh.md)说明了更新源为何固定到产品 fork，以及缺少 OAuth 客户端为何是空状态。

</details>
