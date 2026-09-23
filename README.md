# @hashrace/partner-browser

Official browser-side postMessage SDK for embedding Hashrace games in Partner websites.

Implements the `hashrace.v1` channel: the contract between a Partner-owned parent
page and an embedded Hashrace iframe. The full integration contract — onboarding,
the launch-session API, the launch URL format, every `hashrace.v1` event and field,
the Seamless Wallet webhooks, signatures, idempotency and error codes — is in
[`docs/integration-guide.md`](./docs/integration-guide.md). The SDK is the reference
implementation for the parent side.

## Install

Consumers install directly from GitHub via git ref:

```json
{
  "dependencies": {
    "@hashrace/partner-browser": "github:hashrace/partner-browser#v0.2.0"
  }
}
```

Then `npm install`. The `github:owner/repo#tag` syntax is supported natively by npm 7+, yarn 1.22+, and pnpm 6+. npm clones the repo at the tag on the consumer side, runs the `prepare` script (`tsup` build, ~2s), and installs the built `dist/` + metadata into `node_modules/@hashrace/partner-browser`. Zero extra configuration on the consumer side.

- Package name `@hashrace/partner-browser` comes from `package.json` `name` field.
- Versions are locked by git tag — 1:1 with npm semver.
- Upgrade by swapping the tag (e.g. `#v0.3.0`); no lockfile range drift.
- First install adds a few seconds for the `tsup` build; subsequent installs hit the npm cache.

Zero runtime dependencies. ES Module + CommonJS + `.d.ts` ship together.

## Quick Start

### One-shot iframe (recommended)

```ts
import { embedHashraceIframe } from '@hashrace/partner-browser';

const { client } = embedHashraceIframe({
    launchUrl: '<from your backend /api/v1/partner/launch-session>',
    container: document.getElementById('game')!,
});

client.on('iframe.round_end', ({ round_id }) => {
    // The net change has already been applied to your wallet via the Seamless
    // Webhook S2S channel. You only need to refresh the balance UI here.
});

client.on('iframe.exit_request', (_, ack) => {
    ack({ accepted: true }); // optional reply — the iframe does not wait for it
    // Then tear down the iframe or navigate back to your lobby.
});
```

> **Note:** `iframe.round_end` (and `iframe.round_start` / `iframe.size_change` /
> `iframe.error`) are defined in the protocol but **not yet emitted** by the game
> client. See the [Events](#events) table for what is currently sent.

### Manual (you already have the iframe element)

```ts
import { createPartnerClient } from '@hashrace/partner-browser';

const iframe = document.querySelector('iframe#hashrace-game')!;
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

    handle.on('iframe.round_end', () => {
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

**机制简介：** `launchInPopup` 打开 `about:blank` popup，写入一个不含任何调用方数据的静态 wrapper 骨架，再用 DOM API 创建真正的 Hashrace iframe（`launchUrl` / `iframeAllow` 经 `iframe.src` / `setAttribute` 设置，不经 HTML 解析），并插入 relay 脚本把上行 `hashrace.v1` 信封转发回 opener。游戏客户端零改动。

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
   `send()` only accepts the downstream events listed below and throws on anything
   else. Names such as `deposit_done`, `logout`, `force_bet`, `revoke_session`
   (`FORBIDDEN_DOWN_EVENTS`) get a dedicated error explaining why. Financial state
   flows through Seamless Wallet S2S only; the parent page is not authorized to
   mutate game or session state.
3. **HTTPS only** — `embedHashraceIframe` / `launchInPopup` throw on non-https `launchUrl`
   (dev exception: `http://localhost`).
4. **`iframe.exit_request` is fire-and-forget** — the iframe does not wait for a
   reply and does not change its behavior based on one. Calling `ack({ accepted })`
   is optional; closing the iframe (or not) is entirely your decision.
5. **Dispose on unmount** — always call `client.dispose()` (or `handle.dispose()`
   for popup mode) when the iframe / popup is removed, to detach the `message`
   listener.

## Events

### Upstream (iframe → parent)

| Event | Payload | Needs ack? | Emitted by the game client today? |
|-------|---------|------------|-----------------------------------|
| `iframe.ready` | `{ client_version, protocol_version }` | no | yes |
| `iframe.exit_request` | `{ reason }` — `user_back` / `session_expired` | no (optional reply) | yes |
| `iframe.game_ended` | `{ game_id }` — player left the game ("Back to {brand}" or normal exit) | no | yes |
| `iframe.retry_request` | `{}` — player tapped "Retry" on the maintenance screen; issue a fresh launch URL and re-mount the iframe (launch tokens are single-use) | no | yes |
| `iframe.support_request` | `{}` — player tapped "Contact support"; open your support channel | no | yes |
| `iframe.size_change` | `{ width, height }` | no | **not yet** |
| `iframe.round_start` | `{ round_id, game_code, started_at }` | no | **not yet** |
| `iframe.round_end` | `{ round_id, game_code, net_change_micro, currency, ended_at }` — `net_change_micro` is a decimal-integer **string** in micro-units; the SDK typings still carry the previous `net_change_minor: number` and will follow (see [`docs/integration-guide.md` §5.2](./docs/integration-guide.md#52-游戏--你的页面)) | no | **not yet** |
| `iframe.error` | `{ code, trace_id?, message }` | no | **not yet** |

### Downstream (parent → iframe, allowlisted)

> **The iframe does not consume any downstream event yet.** `send()` delivers the
> message, but the game currently ignores it. The names are reserved by the protocol.

| Event | Payload | Consumed by the iframe today? |
|-------|---------|-------------------------------|
| `parent.resize` | `{ width, height }` | **not yet** |
| `parent.close_request` | `{ reason }` | **not yet** |
| `parent.visibility_change` | `{ visible }` | **not yet** |
| `parent.pause` | `{}` | **not yet** |
| `parent.resume` | `{}` | **not yet** |

`send()` throws on any event not in this table. Financial / session / game-control
names (`FORBIDDEN_DOWN_EVENTS`) get a dedicated error message.

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
- Popup mode (`launchInPopup`) uses `window.open` + `about:blank`; the wrapper
  is assembled with DOM APIs. The popup is same-origin as opener (about:blank inherits opener origin) so relay
  messaging uses strict origin checks against `window.location.origin` on both
  sides.

## Examples

See `examples/vanilla`, `examples/react`, `examples/vue` in this repo. Each
directory contains both an iframe demo (`index.html` / `App.tsx` / `App.vue`)
and a popup demo (`popup.html` / `PopupApp.tsx` / `PopupApp.vue`). See
[`examples/README.md`](./examples/README.md) for how to run them.

## License

MIT — see [LICENSE](./LICENSE).
