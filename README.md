# @hashrace/partner-browser

> **改名通知（2026-05-19）**：本包从 `@hashrace/partner-sdk` 改名为 `@hashrace/partner-browser`，首版新名为 `0.2.0`。import 路径全部从 `@hashrace/partner-sdk` 改为 `@hashrace/partner-browser`；其他 API surface（`createPartnerClient` / `embedHashraceIframe`）完全兼容。改名原因：浏览器 SDK 与未来 server SDK（`@hashrace/partner-node` / `partner-go` / `partner-php` / `partner-python` 等）共享 `@hashrace/partner-` 命名空间，按运行环境/语言后缀区分（参考 Stripe / Plaid / Twilio 业界约定）。
>
> **发布机制（2026-05-19）**：本包**不发布到 npm registry**，直接通过 GitHub git ref 安装；详见下方 §Install。

Official browser-side postMessage SDK for embedding HashMach games in Partner websites.

Implements the `hashrace.v1` channel: the contract between a Partner-owned parent
page and an embedded HashMach iframe. The protocol itself is defined in
[hashmach-docs `architecture/iframe-postmessage.md`](https://github.com/hashrace/hashmach-docs/blob/main/architecture/iframe-postmessage.md) —
the SDK is the reference implementation for the parent side.

## Install

本包不在 npm registry 上。consumer 通过 GitHub git ref 直接安装：

```json
{
  "dependencies": {
    "@hashrace/partner-browser": "github:hashrace/hashmach-partner-browser#v0.2.0"
  }
}
```

然后 `npm install`。`github:owner/repo#tag` 语法 npm 7+ / yarn 1.22+ / pnpm 6+ 都原生支持。安装时 npm 在 consumer 一侧自动 clone 本仓 + 装 devDeps + 跑 `prepare` 脚本（即 `tsup` 构建），把 `dist/` 产物 + 包元数据装入 `node_modules/@hashrace/partner-browser`——consumer 一侧零额外配置。

- 包名 `@hashrace/partner-browser` 来自 `package.json` 的 `name` 字段
- 版本通过 git tag 锁定，与 npm semver 一一对应
- 升级换 tag 即可（如 `#v0.3.0`），无 lockfile range 漂移风险
- 首次 install 多几秒构建时间（~2 秒 tsup），后续 install 走 npm 缓存

**为什么不走 npm registry？** Hashrace 当前未启用 npm 组织付费账号；GitHub git-ref install 提供等价的版本锁定 + 公开访问能力，零运营成本。

Zero runtime dependencies. ES Module + CommonJS + `.d.ts` ship together.

## Quick Start

### One-shot iframe (recommended)

```ts
import { embedHashraceIframe } from '@hashrace/partner-browser';

const { client } = embedHashraceIframe({
    launchUrl: '<from your backend /api/v1/partner/launch-session>',
    container: document.getElementById('game')!,
});

client.on('iframe.round_end', ({ round_id, net_change_minor, currency }) => {
    // The net change has already been applied to your wallet via the Seamless
    // Webhook S2S channel. You only need to refresh the balance UI here.
});

client.on('iframe.exit_request', (_, ack) => {
    ack({ accepted: true });
    // Then tear down the iframe or navigate back to your lobby.
});
```

### Manual (you already have the iframe element)

```ts
import { createPartnerClient } from '@hashrace/partner-browser';

const iframe = document.querySelector('iframe#hashmach')!;
const client = createPartnerClient({
    iframe,
    expectedChildOrigin: 'https://app.hashrace.com',
    onSecurityViolation: (reason, detail) => telemetry.report(reason, detail),
});
```

### Popup mode

对齐 PG SOFT / Pragmatic Play 等行业 popup 启动器形态——游戏在新浏览器窗口内运行，不占 Partner 父页空间。

```ts
import { launchInPopup } from '@hashrace/partner-browser';

document.getElementById('play')!.addEventListener('click', () => {
    const handle = launchInPopup({
        launchUrl: '<from your backend /api/v1/partner/launch-session>',
        window: { width: 1280, height: 720 },
        onPopupBlocked: () => alert('Please allow popups for this site to launch the game.'),
    });
    if (!handle) return;

    handle.on('iframe.round_end', ({ net_change_minor, currency }) => {
        // refresh balance UI
    });
    handle.on('iframe.exit_request', (_, ack) => ack({ accepted: true }));
    handle.onClosed(() => navigateBackToLobby());
});
```

**Constraints：**

- `launchInPopup` 必须在 user gesture（如 `click` handler）**同步路径内**调用，否则浏览器会拦截 popup
- `launchUrl` 必须 `https://`（dev 例外允许 `http://localhost`）
- 句柄 API 与 `PartnerClient` 对齐（`on` / `off` / `send` / `dispose`），另含 `close` / `focus` / `onClosed` / `closed` flag

**机制简介：** `launchInPopup` 在 popup 内通过 `about:blank` + `document.write` 注入一个 wrapper page，wrapper 内嵌真正的 HashMach iframe 并把上行 `hashrace.v1` 信封透明转发回 opener。Cocos 客户端零改动。

### iframe `allow` 属性（必备）

`embedHashraceIframe` 0.2.0 起默认注入：

```
allow="web-share *; clipboard-write *; screen-wake-lock *; fullscreen *"
```

四项权限对齐 PG Soft / Pragmatic Play 等 B2B 厂商对 Partner 父页 iframe 嵌入的强制约定：

| 权限 | 用途 |
|---|---|
| `web-share *` | 游戏内分享按钮调用 `navigator.share()` |
| `clipboard-write *` | 游戏内"复制 transaction id / verify URL"等故障排查辅助 |
| `screen-wake-lock *` | 长 round 期间防屏幕休眠（slot 自动旋转 / crash 高倍率等待） |
| `fullscreen *` | 游戏全屏模式 |

若手工调 `createPartnerClient` + 自家创建 iframe，**必须**自己加这四项权限，否则游戏内 `navigator.share` / `clipboard` / `fullscreen` / `wakeLock` 在 iframe 内会静默失败（故障表现：按钮看似无响应，排查路径极长）。

也可通过 `DEFAULT_IFRAME_ALLOW` 常量导出复用：

```ts
import { DEFAULT_IFRAME_ALLOW } from '@hashrace/partner-browser';

const iframe = document.createElement('iframe');
iframe.setAttribute('allow', DEFAULT_IFRAME_ALLOW);
```

`embedHashraceIframe` 调用方可通过 `iframeAllow` 选项覆盖默认：

- `iframeAllow: 'camera *'` —— 自定义字符串完全覆盖
- `iframeAllow: ''` —— 显式 opt-out，不设 `allow` 属性

## Security requirements

These are not optional. The SDK encodes them so you don't have to re-derive them,
but the responsibility is still yours to keep:

1. **Origin verification** — enforced by default. Do not pass `"*"`. If your product
   has both prod and staging, pass an array: `['https://app.hashrace.com', 'https://app-staging.hashrace.com']`.
2. **Never send financial, session, or game-control events from the parent page.**
   The SDK rejects a documented list at runtime (`FORBIDDEN_DOWN_EVENTS`): anything
   like `deposit_done`, `logout`, `force_bet`, `revoke_session`, etc. Financial
   state flows through Seamless Wallet S2S only; the parent page is not authorized
   to mutate game or session state.
3. **HTTPS only** — `embedHashraceIframe` / `launchInPopup` throw on non-https `launchUrl`
   (dev exception: `http://localhost`).
4. **Respond to `iframe.exit_request` within 5 seconds** — the iframe falls back
   to its own error UI after 5 s. Call `ack({ accepted: true | false })` synchronously
   from your handler.
5. **Dispose on unmount** — always call `client.dispose()` (or `handle.dispose()`
   for popup mode) when the iframe / popup is removed, to detach the `message`
   listener.

## Events

### Upstream (iframe → parent)

| Event | Payload | Needs ack? |
|-------|---------|------------|
| `iframe.ready` | `{ client_version, protocol_version }` | no |
| `iframe.size_change` | `{ width, height }` | no |
| `iframe.exit_request` | `{ reason }` | **yes** (5 s) |
| `iframe.round_start` | `{ round_id, game_code, started_at }` | no |
| `iframe.round_end` | `{ round_id, game_code, net_change_minor, currency, ended_at }` | no |
| `iframe.error` | `{ code, trace_id?, message }` | no |

### Downstream (parent → iframe, allowlisted)

| Event | Payload |
|-------|---------|
| `parent.resize` | `{ width, height }` |
| `parent.close_request` | `{ reason }` |
| `parent.visibility_change` | `{ visible }` |
| `parent.pause` | `{}` |
| `parent.resume` | `{}` |

Anything not in the downstream table that looks financial / session / game-control
is in `FORBIDDEN_DOWN_EVENTS` and throws at runtime.

## Version Policy

| SDK major | Protocol channel |
|-----------|------------------|
| 0.x / 1.x | `hashrace.v1` |
| 2.x | `hashrace.v2` (90-day overlap window with v1) |

During 0.x, breaking changes may land in minor releases — pin to `~0.2.x` for
stability or use `^0.2.0` to receive patch updates only.

## Compatibility

- Node 18+ for the build / publish toolchain (uses `crypto.randomUUID`).
- All evergreen browsers. Safari 14+, Chrome 92+, Firefox 95+, Edge 92+.
- For older browsers, polyfill `crypto.randomUUID` before loading the SDK.
- Popup mode (`launchInPopup`) uses `window.open` + `about:blank` + `document.write`;
  popup is same-origin as opener (about:blank inherits opener origin) so relay
  messaging uses strict origin checks against `window.location.origin` on both
  sides.

## Examples

See `examples/vanilla`, `examples/react`, `examples/vue` in this repo. Each
directory contains both an iframe demo (`index.html` / `App.tsx` / `App.vue`)
and a popup demo (`popup.html` / `PopupApp.tsx` / `PopupApp.vue`).

## License

MIT — see [LICENSE](./LICENSE).
