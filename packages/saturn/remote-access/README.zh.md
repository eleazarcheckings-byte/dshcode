---
description: "可选启用的 Harness 远程访问：固定证书的局域网监听或自备 cloudflared 隧道、设备令牌配对，以及通知流。"
kind: "package-reference"
---

# @saturnai/dsh-remote-access

[English](README.md) | 中文

## 概述

让正在运行的 Harness 可以从手机访问，同时不把它的任何部分搬离所在机器。主机仍照旧在回环地址提供服务；本包在其旁边增加一个监听，只有已配对的设备可以与之通信。该监听把设备流量代理进既有的 Web 服务器，并沿用桌面窗口所用的同一浏览器会话，同时通过 Server-Sent Events 把审批、判定、编队变化与 SaturnBot 通知推送给设备。默认关闭，每一次状态变更都会记入日志，并且不下载任何东西。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

与 `webServer` 和 `client-connection` 一同挂载。它提供 `ctx.remoteAccess`，以及“设置 → 远程”页面调用的生成式 Remote 命名空间。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | `DSH_HOME`，其次 `~/.dsh` | Harness 主目录；状态位于 `<home>/remote/` |
| `bindHost` | `0.0.0.0` | 局域网监听绑定的网卡；设为 `127.0.0.1` 则仅限本机 |
| `port` | `0` | 局域网监听端口；为零表示交由操作系统分配 |
| `hostName` | 机器主机名 | 手机在确认配对前看到的显示名称 |
| `pairingTtlMs` | `600000` | 配对令牌有效期 |
| `certificateValidityDays` | `397` | 生成的监听证书有效期 |
| `tunnelTimeoutMs` | `30000` | 等待 cloudflared 发布地址的时长 |

服务操作均导出为 Remote 方法：`status()`、`enable(mode)`、`disable()`、`pairingCode()`、`revokeDevice(id)`。`publish(event)` 有意**不**作为 Remote 方法：其他 Saturn 包以鸭子类型方式调用（`ctx.get('remoteAccess')?.publish({ type: 'verdict', title, body })`），因此未包含远程访问的组合不会付出任何代价。

配对契约，移动端伴侣应用逐字实现：

```json
{
  "v": 1,
  "name": "<host name>",
  "url": "https://<lan-ip>:<port>",
  "token": "<opaque 32-byte base64url pairing token>",
  "fingerprint": "<sha256 of the self-signed certificate, hex, LAN mode only>",
  "expires": "<ISO time, ten minutes out>"
}
```

设备向 `POST <url>/saturn/remote/pair` 提交一次 `{ token, device: { name, platform } }`，得到 `{ deviceToken, sessionCookieName, device }`。此后每个请求携带 `Authorization: Bearer <deviceToken>`；由于 WebView 无法为文档后续发起的子资源请求附加该请求头，通过鉴权的请求还会把同一凭据以 `HttpOnly` Cookie 的形式写回，名称即 `sessionCookieName`。`GET <url>/saturn/remote/events` 是通知流，`GET <url>/saturn/remote/devices` 列出已配对设备，`DELETE <url>/saturn/remote/devices/<id>` 吊销其中之一。其余请求一律代理至回环 Web 服务器。

当 `PATH` 中已存在 `cloudflared` 时，隧道模式会启动 `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<代理端口>`。它从不自行获取该程序：若未安装，状态会报告 `tunnel-missing`，设置页面会说明从何处获取。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

**鉴权是借用的，不是另起炉灶。** 浏览器鉴权由 `client-connection` 拥有：在根 URL 用进程启动令牌换取一个绑定 authority 的签名 Cookie。边缘监听对 `http://127.0.0.1:<回环端口>` 执行同一次交换，并且只把所得 Cookie 保存在内存中。因此被代理的请求到达上游时，穿着的正是桌面窗口自己的会话，而设备永远看不到它——每个被代理响应中的上游 `Set-Cookie` 都会被剥离。

**浏览器防线在主机头改写后依然成立。** `client-connection` 会拒绝 `Host` 既非回环也未声明的 `/api` 请求，也会拒绝与之不匹配的 `Origin`。边缘为了抵达回环必须改写 `Host`，那会钝化这两道防线，因此它先自行施加：带有明确 `sec-fetch-site: cross-site` 标记的请求被拒绝，`Origin` 必须与设备实际拨入的 authority 一致。此后才为回环这一跳替换 `Host`、`Origin`、`Cookie` 与 `Authorization`。改写永远无法把跨站请求洗白成同源请求。

**机密以仍能工作的最短路径持有。** 配对令牌在内存中存活十分钟，只能使用一次，并在监听关闭或重新生成配对码时立即丢弃——无法在重启后存活的令牌，也就无法日后在磁盘上被找到。设备令牌只返回一次，仅以 SHA-256 摘要形式存入 `<home>/remote/devices.json`（权限 0600，原子替换），并以常量时间比较。日志记录动作与简短的非机密上下文，从不记录令牌、密钥或证书。

**证书在此铸造。** Node 提供 X.509 解析与签名，却没有证书写入器，因此 `certificate.ts` 在 P-256 密钥对之上手工组装 DER 形式的 TBSCertificate：v3、16 字节随机序列号、`basicConstraints`（CA 为否，critical）、`keyUsage`（digitalSignature，critical）、`extKeyUsage`（serverAuth），以及一个 `subjectAltName`，其中包含本机所有非回环 IPv4 地址，外加 `127.0.0.1` 与 `localhost`。它是叶证书而非证书颁发机构：手机固定配对载荷中的 SHA-256，而不是构建证书链。测试套件用 `node:crypto` 自带的 `X509Certificate` 解析每一张签发的证书，并对其完成一次真实 TLS 握手——任何形态不合法的字节串都无法通过。

**审批只被观察，绝不被代答。** 服务在 `approval/request` 瀑布流上注册监听，并立即交给 `next()`，只在经过时发布一帧通知。远程访问可以在会话进行中开启，而不改变 Harness 所问的问题，也不改变由谁作答。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Web 服务器](../../host/webserver/README.zh.md) — 边缘监听所面向的回环载体。
- [客户端连接](../../client/connection/README.zh.md) — 边缘所借用的浏览器会话。
- [远程设置页面](../../client/ui-remote-access/README.zh.md) — 驱动它的设置卡片。
- [用户审批](../../interaction/user-approval/README.zh.md) — 通知流所观察的瀑布流。

<a id="model-experience"></a>
## 模型体验

None, as this package carries transport and device state only; it registers no tool, prompt section, or model-visible text.

#### KV Cache effect

无。远程访问不构造任何模型请求，也不改变已组装的提示词，因此无论其开启与否，原本可复用的前缀依然可复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **已配对设备获得的是对 Harness 的完整窗口，而非受限视图。** 设备令牌可以做桌面窗口能做的一切，因为它正是以该会话被代理的。按设备划分权限范围属于后续工作；今天唯一的粒度是吊销。
- **设备 Cookie 承载的就是设备令牌本身。** 它是设备已经持有的同一份机密，经由同一条传输发送，并标记为 `HttpOnly`；引入独立的服务端会话 id 只会增加一层间接而不减少暴露面，故留待后续。
- **只有 IPv4 地址会进入证书。** 纯 IPv6 网络无法被公布，此时发布的地址为回环地址，并附带 `issue: 'no-lan-address'`。
- **上游会话失效时返回 503 而非 401。** 边缘为下一个请求重新执行交换，而不重放当前请求，因为重放需要缓冲可能达数百兆字节的请求体。
- **隧道模式发布的是快速隧道。** 其主机名每次启动都会变化，因此固定在旧地址上的已配对设备需要重新指向；具名隧道属于后续工作。
- **绝不代用户安装 cloudflared。** 在他人机器上下载并执行一个联网二进制程序应由他本人决定；状态只报告 `tunnel-missing` 并就此停止。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[决策记录](../../../.agents/notes/implemented/feature/2026-09-15-saturn-remote-access.zh.md)解释了借用会话的设计、防线的先后次序，以及为何证书是手工写入的。

</details>
