# @saturnai/dsh-client-ui-skin-saturn

[English](README.md) | 中文

Saturn Premium 是深色应用皮肤（skin）：中性黑色表面、白色文字、细灰色边框，品牌、焦点与主操作均使用白色强调色。完整的静态色阶保持从浅到深的顺序，使上游语义别名（alias）保持其原有含义。状态色保留各自的别名。

## 使用本包

作为 web profile 中的一个 `dsh.client` 行挂载。该 effect 在皮肤挂载期间保持上游的深色主题属性与浏览器 color scheme，应用 Saturn 的 body 属性与 favicon，并在释放（dispose）时还原这些值。若缺少 Saturn 属性，该作用域样式表保持无效（inert）。

```yaml
- insert:
    - id: ui-skin-saturn
      name: '@saturnai/dsh-client-ui-skin-saturn'
```

`skin.json` 标识为 `saturn-premium`。该皮肤以 workspace 包形式提供，不会进入皮肤中心（skin-center）选择器。

## Application tokens（应用 token）

body 作用域发布 `--saturn-void`、`--saturn-surface`、`--saturn-surface-raised`、`--saturn-surface-hover`、`--saturn-stroke`、`--saturn-stroke-strong`、`--saturn-ink`、`--saturn-muted`、`--saturn-accent`、`--saturn-accent-dim` 与 `--saturn-accent-secondary`。动效使用 `--saturn-ease` 与 `--saturn-duration`。各组件消费这些 token 并保留上游别名作为回退（fallback）。该皮肤不拥有任何 canvas 或动画时钟；各组件自行拥有其视觉状态、可见性检测与清理逻辑。reduced-motion 媒体规则会抑制 CSS transition 与重复动画。

## Type system（字体系统）

该皮肤自托管一个可变（variable）display/body 字体族与一个等宽（mono）字体族，并重新指向两个上游字体变量，使所有既有组件无需改动即可继承它们：

- **Instrument Sans**（variable；`wght` 400-700，`wdth` 75-100；OFL）同时承担 UI 与 display 两种角色。`--saturn-font-display` 与 `--saturn-font-body` 均解析为该字体族；display 角色还额外显式固定 `--saturn-font-display-variation: 'wdth' 100`（该轴的宽/默认一端，显式声明而非依赖继承的默认值），供消费方结合自身的紧缩字间距（tight tracking）使用。
- **Commit Mono**（两个静态字重，400/700；OFL——见下文 Licensing）即 `--saturn-font-mono`，用于规格面板（spec plates）与回执（receipts）。
- 两个字体族均以自托管的 `woff2` 形式提供，位于 `apps/web/public/fonts/`，`font-display: swap`，并从 `apps/web/index.html` 预加载（preload）。每个字体族还声明了一个与其度量（metrics）匹配的本地回退字体（`size-adjust` 加三个 `*-override` 描述符，均以 `fontTools` 依据每个字体自身的 `OS/2`/`head` 表与其系统回退字体计算得出，而非凭空猜测），使得字体切换（swap）不会产生可见的布局回流（reflow）。
- `--dsw-font-family` 与 `--ds-font-family-code`——这两个变量几乎被所有既有组件用于 body 与 mono 文本——在本文件自身已用于调色板的更高特异度选择器 `body[data-dsh-saturn][data-dsh-saturn]` 下被重新指向 `--saturn-font-body` / `--saturn-font-mono`，使整个应用无需改动任何消费方即可获得 Saturn 字体系统。

### Licensing（授权许可，已对照官方来源核验，而非假定）

两个字体族均为 **OFL**，而非最初简报（brief）对 Commit Mono 所假设的 MIT：`eigilnikolajsen/commit-mono` 的仓库根 `LICENSE`（MIT）覆盖其展示站点与构建工具，但字体二进制文件本身携带各自的 `LICENSE-FONT`——即 SIL Open Font License，与该发行版 zip 包中随 `.otf` 文件一同提供的 `license.txt` 文字完全一致。因此 `apps/web/public/fonts/` 携带的是 `LICENSE-OFL.txt`（Instrument Sans）与 `LICENSE-OFL-COMMITMONO.txt`（Commit Mono），而非会误代表所分发字节实际条款的 `LICENSE-MIT.txt`——完整的获取／核验过程见 Agent Note。

Commit Mono 的官方仓库不提供 `woff2`，只提供 `.otf`/`.ttf`；此处的两个字重是用 `fontTools` 从上游 `v1.143` 发行版编译而来，未改动任何轮廓（outline）或度量（metric）。

## 模型体验

无。本包仅改变浏览器呈现。

#### KV Cache 影响

无。该皮肤不组装任何模型请求。

## 已知限制与延期工作

- **不支持浅色外观。** 该皮肤在挂载期间强制深色外观；浅色外观需要一套完整的替代调色板与主题策略。
- **本包自身代码为 MIT**（见 `package.json`）；它所自托管的字体并非如此——Instrument Sans 与 Commit Mono 均为 OFL（见上文 Licensing）。

**Runtime invariant:** 不发布任何 companion。token 极性（polarity）与对比度由本包的调色板测试验证，该皮肤不拥有任何独立的运行时数据视图。
