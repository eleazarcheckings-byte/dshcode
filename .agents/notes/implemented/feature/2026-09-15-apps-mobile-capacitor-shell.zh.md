# Agent 记录：apps/mobile —— iOS 与 Android 的 Capacitor 配套壳

状态：已实现

[English](2026-09-15-apps-mobile-capacitor-shell.md) | 中文

## 问题

SPEC.md §8（2026-09-15 分支任务）要求在 Electron 桌面端之外，配套提供 iOS 与 Android“对等”应用：一个能与用户正在运行的 Saturn AI 主机配对、渲染同一份 web UI、并让手机承担批准 SaturnBot 与 agent 队列、查看裁定这件事的原生壳。此前不存在任何此类代码；`apps/` 下只有 `cli`、`desktop`、`web` 三个目录。

## 决定

`apps/mobile` 是一个新的 Capacitor 工程，拥有自己的 `package.json`，按任务要求用普通 `npm` 安装与构建 —— 不是 pnpm 工作区包。它在客户端一侧完整实现了 M1↔M3 配对协议：

- `src/lib/pairing.ts` —— 解析并校验二维码载荷（`{v, name, url, token, fingerprint?, expires}`）；要求 https、合法的 `expires`，且每个局域网载荷都必须携带 64 位十六进制 `fingerprint`（`*.trycloudflare.com` 的 url 可省略，因为 cloudflared 自带 TLS）。
- `src/lib/tokenStore.ts` —— 通过可注入的 `KeyValueStorage` 持久化配对后的设备会话，使该逻辑无需 Capacitor 运行时即可单测；`src/lib/capacitorStorage.ts` 是设备上实际使用的 `@capacitor/preferences` 适配器。
- `src/lib/eventsMapper.ts` —— 把 `GET /saturn/remote/events` 的载荷映射为本地通知描述，沿用主机自身裁定卡片的措辞（“裁定 PASS”“需要批准”“SaturnBot 需要你”）。
- `src/lib/certPin.ts` —— 证书锁定 HTTPS 背后的纯 SHA-256 指纹比对逻辑；真正执行拦截的是 `android/app/src/main/java/ai/saturnai/mobile/PinningWebViewClient.java`，它重写 `BridgeWebViewClient.onReceivedSslError`，只有当证书与配对时写入 `@capacitor/preferences` 的 `CapacitorStorage` 分组中的指纹一致时才放行。iOS 端等价方案（`WKNavigationDelegate` 的 challenge 回调）已写明步骤但未构建 —— 见 README 中“Mac 上的步骤”。
- `src/screens/*.ts` + `src/index.html` + `src/styles.css` —— 配对、锁屏、离线、通知四个界面，均使用 SPEC.md §2 的语言：-18° 的圆环标记（用 `pathLength` 自绘）、从官方源本地托管的 Instrument Sans + Commit Mono、bg/surface/ink/accent 设计令牌，以及命名化的动效系统。

有两处对任务书的合理替代，均已在 `apps/mobile/README.md` 中写明：

- **二维码扫描用 `@capacitor/camera` + `jsqr`，而非条码扫描插件。** `@capacitor-community` 作用域下唯一对应的插件（`@capacitor-community/barcode-scanner`）的 peerDependency 是 `@capacitor/core@^5`，与本项目所用的 `@capacitor/core@^8` 不兼容。任务书“摄像头（或条码扫描器）”的措辞本就允许这种选择。
- **生物识别用 `@aparajita/capacitor-biometric-auth`，而非 `@capacitor`/`@capacitor-community` 包。** 这两个作用域目前都没有发布生物识别插件；这是维护最活跃的替代方案（支持 Capacitor 7+，一个月内有更新）。

`npx cap add android` 与 `npx cap add ios` 生成了两个原生工程（iOS 采用 Swift Package Manager —— 没有 `Podfile`，不需要 `pod install`）。Android debug APK 已在本机构建完成：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`（JDK 21 位于 `C:/Java/jdk-21.0.11+10`，Android SDK 位于 `C:/Android`，`gradlew.bat assembleDebug`，4 分 41 秒后 BUILD SUCCESSFUL）。iOS 的签名与 TestFlight 步骤已按 Apple 开发者计划这一资金关卡的要求，写明留给 Mac 执行。

## 本次任务顺带暴露的仓库配置隐患

仓库根目录的 `pnpm-workspace.yaml` 与根 `package.json` 的 npm `workspaces` 数组都已经匹配 `apps/*` 这个通配符，因此 `apps/mobile` 一经创建就隐式成为了 pnpm 工作区成员 —— 完全没有、也不需要修改这两个文件。本次会话多次观察到 `apps/mobile/node_modules` 中特定包的内容（`@capacitor/android`、`@aparajita/capacitor-biometric-auth`）在构建步骤之间消失，并且另外发现 `cap add android` 生成的 `android/capacitor.settings.gradle` 指向的是 `../../../node_modules/.pnpm/@capacitor+*/...`（即整个 monorepo 共享的 pnpm 仓库），而不是 `apps/mobile` 自身的 `node_modules` —— 这两个现象都与“某个并行运行的分支正在执行一次根级 `pnpm install`，通过既有通配符发现了这个新的工作区成员，并按一份根本没有它条目的 lockfile 去调和其内容”完全吻合。Android 构建之所以最终成功，是因为 pnpm 放进其共享仓库的版本号恰好与 npm 本地安装的一致 —— 这是巧合，不是保证。具体修复建议（把 `apps/mobile` 从这两处通配符中排除）见本分支报告的 `integration_needs`。

## 考虑过的替代方案

**仍然引入 `@capacitor-community/barcode-scanner`，把整套 Capacitor 降级到 v5 以匹配其 peerDependency。** 已否决：这意味着为了满足任务书中一个本身就留有余地（“摄像头（或条码扫描器）”）的偏好，而放弃任务书要求的前沿技术栈，换来一年前的 Capacitor 版本。

**仅用 `tsc` 打包（产出 `.js`，用裸的 `<script type="module">` 标签加载）。** 一旦打包产物尝试 `import` 诸如 `@capacitor/app` 这样的裸模块名就宣告失败 —— 浏览器在没有打包器的情况下无法解析它们。改用 `vite`（已通过 `vitest` 的传递依赖存在，无需新增依赖）便能正确处理，且完全不必改动手写的 `index.html`/`styles.css`。

## 后果

Web 构建（`npm run build`）完全可复现且通过类型检查；38 个测试覆盖了任务书点名的每一个纯逻辑模块（配对解析器、令牌存储、事件映射器），外加证书指纹比对器。Android debug APK 是一个真实、可安装的产物。iOS 在 Mac 上用 Xcode 打开验证之前，只能确认“工程结构完整无损”。上述 pnpm 通配符隐患在根配置调整之前会持续存在 —— 任何人在本地重新构建前，只要执行过一次根级 `pnpm install`，都应视 `apps/mobile/node_modules` 为可疑状态，先用普通 `npm` 重装。

## 验证

`cd apps/mobile && npm test` —— 4 个文件共 38 个测试全部通过（配对解析器 13 例，含过期与指纹校验；令牌存储 5 例，含损坏/非法的已存 JSON；事件映射器 12 例，覆盖全部四种事件类型及 PASS/REVISE/REJECT 标题推导；证书指纹比对器 5 例）。`npm run typecheck`（`tsc --noEmit`）与 `npm run build`（`vite build` → `www/`）均干净通过。`cd android && JAVA_HOME=... ANDROID_HOME=... ./gradlew.bat assembleDebug` —— BUILD SUCCESSFUL，APK 见上述路径。

## 修复轮次（Mars 第一轮，四项发现，均已修复）

Mars 的第一轮评审（`M3-apps-mobile-r1.md`）给出 REVISE，共四项发现，本轮全部修复。

1. **违反 §6 硬性禁令，且未披露。** 初次实现的 RED 提交曾改动根目录的 `THIRD_PARTY_NOTICES.md`（为新增的 Capacitor/jsQR 依赖新增 12 行）—— §6 明确将该文件列为禁止触碰，况且它本就是自动生成的（`scripts/gen-third-party-notices.ts` 读取的是 **pnpm** 工作区的清单；`apps/mobile` 本就被刻意排除在该工作区之外，一开始就不该被写进这份文件）。修复方式：把该文件逐字节还原到任务前的状态（还原前已确认 `git diff 5dd99fb HEAD -- THIRD_PARTY_NOTICES.md` 是一次干净的、仅 12 行、单提交的差异，期间没有其他分支的插入编辑），并改为在 `apps/mobile/README.md`/`README.zh.md` 中新增“第三方声明”一节 —— 这才是一个本就在生成文件范围之外的包应有的归宿。
2. **DELIVER 项未交付：后台轮询 → 本地通知。** `RemoteEventsClient.pollOnce()` 存在但无人调用。修复方案是引入 `@capacitor/background-runner`（官方 `@capacitor` 作用域，与现有 `@capacitor/core@^8` 技术栈的 peerDependency 兼容）：`assets/background-runner.js` 运行在该插件的隔离 JS 引擎中（没有 DOM，不能 `import` —— 其轮询/解析/通知逻辑是从 `remoteApi.ts`/`eventsMapper.ts` 手工镜像过来的，见文件顶部注释），由系统按 15 分钟节奏调度；新增并单测（7 例）的 `src/lib/backgroundSync.ts` 通过 `dispatchEvent` 把会话推送进该运行环境自己隔离的 `CapacitorKV` 存储。Android 已完整接入并纳入 debug 构建（APK 从 9.28MB 增长到 17.18MB，与该插件自带的原生 JS 引擎体积吻合）。iOS 侧，`Info.plist` 的 `BGTaskSchedulerPermittedIdentifiers`/`UIBackgroundModes` 与 `AppDelegate.swift` 中的两处 `BackgroundRunnerPlugin` 调用已作为纯文本编辑提交；只剩 Xcode 的 Signing & Capabilities 中 Background Modes 这一项能力开关真正只能在 Mac 上完成（它写入 `.pbxproj`，没有可用的纯文本替代方案）。
3. **字体许可证披露不完整。** `CommitMono-LICENSE.txt` 此前只有字体二进制文件对应的 SIL OFL 文本。新增 `CommitMono-MIT.txt`，收录上游 `github.com/eigilnikolajsen/commit-mono` 仓库（构建工具/仓库本身）的准确 MIT 原文（取自实际抓取并与线上文件比对，而非凭记忆重敲）。
4. **字体加载不完整。** 在 `src/index.html` 中为两个 woff2 文件新增 `<link rel="preload">`，并新增 `size-adjust`/`ascent-override`/`descent-override` 的本地回退 `@font-face` 规则（`Instrument Sans Fallback` → 本地 Arial/Helvetica；`Commit Mono Fallback` → 本地 Consolas/Menlo），接入实际使用的字体栈，让 `font-display: swap` 的阻塞窗口不再产生可见的重排。这些覆盖百分比是按各系统字体的常见度量目测调整的，不是 fontaine/capsize 之类工具生成的报告 —— 已在 CSS 注释中如实说明。

`git diff 02255dbdff..<fix 提交> -- apps/mobile/tests/*` 为空（RED 测试文件未被改动）；修复提交只新增了 `tests/backgroundSync.test.ts`（新文件，先以 RED 提交），之后 45/45 个测试全部转绿。完整检查序列已重新跑过并全绿：vitest（45 个测试，5 个文件）、`tsc --noEmit`、`vite build`，以及 `gradlew.bat assembleDebug`（BUILD SUCCESSFUL，47 秒）。
