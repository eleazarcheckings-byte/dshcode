# Agent Note：桌面更新与 izzy.la 账户

Status: implemented

[English](2026-09-15-desktop-updater-and-account.md) | 中文

## 问题

已打包的壳仍把 `whitelonng/dshcode` 写进仓库元数据，因此日后一旦接上 electron-updater，更新源会跟到第三方所有者。没有检查更新的界面，设置里也没有本产品的账户——只有其他依赖方（SaturnDesign）在 izzy.la 上持有客户端。

## 决策

把更新频道固定为 `eleazarcheckings-byte/dshcode`：写入 `apps/desktop/app-update.yml`、`electron-builder.yml` 的 `publish`，以及 `package.json` 的 `repository.url`。检查器使用 electron-updater 的 GitHub `latest.yml` 协议。检查是一个按钮（设置 → 账户，以及 Windows 窗口菜单）。不下载、不在退出时安装；缺失的源被报告为空。没有 YAML 但有更新 GitHub 标签时，报告为有新安装包、尚无自动更新源。

账户是新的设置页（`@saturnai/dsh-client-ui-settings-account`），外加 `$DSH_HOME/account/session.json` 中的持久会话。线上授权地址是 `https://izzy.la/api/auth/oauth2/authorize`。SaturnDesign 的客户端 id 会被忽略。没有 `SATURN_AI_OAUTH_CLIENT_ID` 时，登录停留在空的未连接状态。`connected: true` 但没有 `sub` 的记录会塌缩为未连接。

## 备选方案

**把 electron-updater 加为新的工作区依赖。** 本切片不能改 lockfile。源 URL、YAML 解析与 `app-update.yml` 已是同一契约；以后加包装不会改频道。

**复用 SaturnDesign 的 OAuth 客户端。** 那是另一个依赖方，回调不同。混用会把 SaturnDesign 的身份画成 Saturn AI 桌面用户。

**启动时静默检查。** 任务要求由用户发起。404 的源每天早上都会看起来像故障。

## 影响

web-app bundle 在 `ui-settings-general` 之后挂载 `@saturnai/dsh-client-ui-settings-account`，并依赖该包。桌面检查（窗口菜单 + IPC）不依赖那一行。在 izzy.la 上注册 Saturn AI 的 OAuth 客户端（新的 `client_id` + 回环回调）属于 Gate。
