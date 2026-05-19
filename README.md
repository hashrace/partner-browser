# @hashrace/partner-sdk

Official postMessage SDK for embedding HashMach games in Partner websites.

Implements the `hashrace.v1` channel: the contract between a Partner-owned parent
page and an embedded HashMach iframe. The protocol itself is defined in
[hashmach-docs `architecture/iframe-postmessage.md`](https://github.com/hashrace/hashmach-docs/blob/main/architecture/iframe-postmessage.md) —
the SDK is the reference implementation for the parent side.

## Install

```bash
npm install @hashrace/partner-sdk
```

Zero runtime dependencies. ES Module + CommonJS + `.d.ts` ship together.

## Quick Start

### One-shot (recommended)

```ts
import { embedHashraceIframe } from '@hashrace/partner-sdk';

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
import { createPartnerClient } from '@hashrace/partner-sdk';

const iframe = document.querySelector('iframe#hashmach')!;
const client = createPartnerClient({
    iframe,
    expectedChildOrigin: 'https://app.hashrace.com',
    onSecurityViolation: (reason, detail) => telemetry.report(reason, detail),
});
```

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
3. **HTTPS only** — `embedHashraceIframe` throws on non-https `launchUrl`.
4. **Respond to `iframe.exit_request` within 5 seconds** — the iframe falls back
   to its own error UI after 5 s. Call `ack({ accepted: true | false })` synchronously
   from your handler.
5. **Dispose on unmount** — always call `client.dispose()` when the iframe is
   removed, to detach the `message` listener.

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

During 0.x, breaking changes may land in minor releases — pin to `~0.1.x` for
stability or use `^0.1.0` to receive patch updates only.

## Compatibility

- Node 18+ for the build / publish toolchain (uses `crypto.randomUUID`).
- All evergreen browsers. Safari 14+, Chrome 92+, Firefox 95+, Edge 92+.
- For older browsers, polyfill `crypto.randomUUID` before loading the SDK.

## Examples

See `examples/vanilla`, `examples/react`, `examples/vue` in this repo.

## License

MIT — see [LICENSE](./LICENSE).
