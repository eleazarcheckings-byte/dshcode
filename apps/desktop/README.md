# DSHCode desktop application

English | [中文](README.zh.md)

`@dshcode/desktop` is the Electron shell that turns the existing DeepSeek Harness Web UI into an installable macOS and Windows application. It does not fork or duplicate the renderer UI.

The Saturn AI desktop includes the monochrome Saturn canvas, restrained stars and constellations, the separate SaturnBot management window, and [packaged output workflows](../../packages/skill/skill-premium-output/README.md) for websites, motion, and finished artifacts. Animation respects reduced-motion and pause controls. Integrations use the user's configured credentials; a packaged workflow does not imply that an external service is connected.

## Runtime model

The Electron main process calls the shared `@deepseek-ai/dsh/profile-boot` entry and boots the existing `web` profile in-process. No CLI process or separately managed server child is spawned. The BrowserWindow opens the address reported by the activated WebServer service only after the complete Harness tree has booted.

Packaged Electron does not expose the Node loader internals required by Cordis HMR. The desktop launcher therefore disables live watching of the profile-level and home-level `cordis.patch.yml` files; their contents are still loaded at startup, and ordinary settings managed by the Web UI keep their own live behavior. Restart DSHCode after manually editing either patch file.

The desktop passes `--no-open` and loads the authenticated loopback URL from the connection service in its own BrowserWindow. The launch token is exchanged for the renderer session cookie before the clean application URL loads.

## Plugin boot-failure recovery

One incompatible plugin must never brick the application. Startup failures are attributed to installed plugins and recorded in a bounded per-plugin ring (`$DSH_HOME/boot-failures.json`, at most 8 records, 90-day retention); a native recovery dialog then offers 继续（禁用插件并重启） (disable the blamed plugins and restart — the same patch-row write the settings switch performs), 安全模式启动 (start with the user patch layers skipped, via `$DSH_HOME/safe-mode`), or 退出. The plugin list in Settings shows a 启动失败 badge per affected plugin with 让 Agent 修复 (opens a conversation whose workspace is the plugin install root `$DSH_HOME/profiles`, seeded with the failure record and install path) and 复制错误. Hard crashes and hangs are covered by a boot lifecycle marker (`$DSH_HOME/boot-marker.json`): a launch that dies before the marker reaches `ok` continues the failure streak, and after three consecutive failures the dialog defaults to safe mode.

## Security and lifecycle

- The WebServer binds only to `127.0.0.1` with port `0`, which asks the operating system to atomically select an available ephemeral port.
- Electron permits one DSHCode instance. A second launch focuses the existing window instead of starting another Harness tree or listener.
- The renderer uses context isolation, disables Node integration, enables the Chromium sandbox, denies permission requests, and may navigate only within the exact application origin. HTTPS links open in the system browser; other cross-origin targets are blocked.
- Native quit requests first await the Harness shutdown controller. The WebServer disposer closes normal and upgraded sockets, then Electron exits and the ephemeral port becomes reusable.

## System tray and window close

The main harness's top-right **SaturnBot** button opens a separate native management window without a separate taskbar entry. Its native Minimize control hides the dashboard and returns focus to the main harness. Clicking the same SaturnBot button restores the existing window without reloading it, preserving its unsent drafts. Repeated clicks focus that window; closing it destroys the dashboard but leaves the configured runner active while the host remains open. Its three-column interface shows agents, conversations, and execution details from the same host runtime. The native window accepts only the exact same-origin `/?saturnbot=1` route, retains the renderer sandbox, and cannot open further application windows. The [minimize decision](../../.agents/notes/implemented/feature/2026-09-15-saturnbot-minimize-to-harness.md) records the window ownership.

The sandboxed preload exposes `restoreSaturnBot(): Promise<boolean>` to restore an existing dashboard. Its IPC handler accepts only the main harness renderer; it returns `false` when there is no live SaturnBot window. This bridge does not create windows or expose general native window control. Browser clients retain the ordinary named-window focus behavior.

- The application always installs a system tray icon (colored on Windows and Linux, a monochrome template image on macOS). On Windows and Linux, left-clicking the tray shows and focuses the main window; the tray context menu offers 显示主界面 (show main window) and 退出 (quit). On macOS the context menu is the platform convention.
- Clicking the window close button hides the window to the tray by default: the Harness tree keeps running and the tray restores the window. A real exit happens only through the tray 退出 item (or the macOS app menu) and still waits for the Harness shutdown controller first.
- Windows and Linux run without the default Electron menu bar (File/Edit/View/...); macOS keeps its system menu bar with the standard edit roles.
- On Windows the main window uses a custom single-row title bar: the web shell draws the product name and a menu button in a draggable strip, and native minimize/maximize/close buttons (`titleBarOverlay`) occupy the same row. The menu button pops a native menu with 隐藏到托盘 (hide to tray), 重启应用 (restart the application in place — applies profile and patch changes), and 退出 (quit). macOS and Linux keep their native title bars.
- The renderer receives the frame mode and product name through the sandboxed preload bridge (`lib/preload.cjs`, CommonJS because sandboxed preloads cannot load ESM); the window-menu IPC handler accepts only senders from the application origin.
- The runtime tray icons (`assets/tray.png` at 32 px and `assets/tray16.png` at 16 px, the colored app logo) are generated from `assets/icon.svg` with `rsvg-convert`; macOS loads both as an explicit 1x/2x representation pair so the menu bar logo stays crisp on Retina displays.

## Build

From the repository root, install the declared Node.js and pnpm versions, then run:

```sh
pnpm install
pnpm run build
pnpm --filter @dshcode/desktop run package
```

After the repository build, `package` creates an unpacked application for the current platform. `pnpm --filter @dshcode/desktop run dist` creates the configured distributable targets. Output is written to `.artifacts/desktop/release/`.

### Platform targets

```sh
pnpm --filter @dshcode/desktop run dist:mac:arm64
pnpm --filter @dshcode/desktop run dist:mac:x64
pnpm --filter @dshcode/desktop run dist:win:x64
```

The `Desktop` GitHub Actions workflow runs the same targets on native macOS and Windows runners. Cross-compiling the Windows installer on macOS is not the supported verification path.

`node apps/desktop/scripts/smoke-packaged-startup.mjs` launches the packaged main entry with an isolated Harness home and Electron user-data directory, waits for the workspace interface on its loopback URL, then quits through the application shutdown path. Every desktop packaging job requires this check before uploading installers.

The smoke restores the packaged manifest, unlinks temporary profile junctions without traversing package targets, and removes only its verified scratch directory. Captured startup diagnostics omit URL credentials, queries, and fragments. Launch and cleanup failures both fail the check; the [cleanup decision](../../.agents/notes/implemented/bug-fix/2026-09-15-packaged-smoke-junction-cleanup.md) records the Windows constraint.

`node apps/desktop/scripts/test-electron-picker.mjs` runs the directory-picker binding tests inside Electron's Node runtime on both platforms. COM calls are mocked; selected paths use real koffi decoding. The Windows packaged smoke additionally opens and aborts the actual dialog; completing a selection in the installed application remains a manual check.

A `desktop-v*` tag publishes the complete successful matrix and `SHA256SUMS.txt` to [GitHub Releases](https://github.com/whitelonng/dshcode/releases). Manual workflow runs retain their packages as ordinary Actions artifacts without creating a Release.

## Packaging

The staging script creates a production-only `pnpm deploy` directory outside the source workspace. Before deployment it traverses application, bundle, package, and vendor manifests and verifies that every required workspace peer is a direct runtime dependency, including peers reached through the CLI's profile bundles. The full source workspace installation is restored after staging because `pnpm deploy` records its production filter in shared workspace state. The [runtime-closure decision](../../.agents/notes/implemented/feature/2026-09-15-desktop-profile-runtime-closure.md) records the packaging check.

The application uses unpacked resources because the Harness profile fallback creates real package symlinks. The distribution includes the upstream MIT license, generated third-party notices, and an independent DSHCode application icon; the embedded Web UI retains its upstream attribution. Electron is treated as a shipped runtime dependency even though electron-builder requires it to remain a development dependency in the source manifest.

## Current limitations

- Preview packages are deliberately unsigned. macOS Gatekeeper and Windows SmartScreen may warn about local builds until a future release configures platform signing and macOS notarization.
- Automatic updates are not configured.
- The embedded Web UI carries the Saturn AI brand, and desktop application and installer branding use the same Saturn identity; see the repository [license and branding notice](../../README.md).
- The recovery dialog, tray, and custom title bar need a manual pass on a native Windows build.
