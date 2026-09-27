# Changelog

All notable changes to `@hashrace/partner-browser` are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Security

- `launchInPopup`: fixed an XSS in the popup wrapper. `launchUrl` and `iframeAllow`
  were embedded into HTML attributes as JSON strings, so a value containing `"`
  could break out of the attribute and inject an event handler that ran in the
  popup (same origin as the Partner page). The wrapper is now a static skeleton;
  the iframe is created with DOM APIs (`iframe.src` / `setAttribute`).

### Added

- Upstream events `iframe.retry_request`, `iframe.support_request` and
  `iframe.game_ended` (`{ game_id }`), which the game client emits.

### Changed

- **Breaking:** `createPartnerClient` now requires `expectedChildOrigin` and throws
  when it is missing or empty. `DEFAULT_CHILD_ORIGIN` (`https://app.hashrace.com`)
  has been removed: no environment actually serves the game there, and the game
  domain is assigned at onboarding per environment — a wrong default silently
  dropped every message as an origin mismatch. `embedHashraceIframe` /
  `launchInPopup` are unaffected (they take the origin from `launchUrl`).
- Docs and examples use the only launch path the game client accepts,
  `/game/{game_id}?launch={launch_token}` (previously `/lobby?launch=`).
- Integration guide: the nonce de-duplication window is 630 seconds
  (≥ 2 × 300 s timestamp tolerance + 30 s), not 10 minutes.
- `send()` (both `PartnerClient` and `PopupHandle`) now rejects any event that is
  not a `DownEventMap` key. Previously only `FORBIDDEN_DOWN_EVENTS` was checked.
- The popup relay only forwards known upstream / downstream event names.
- `IframeExitRequestPayload.reason` is now `'user_back' | 'session_expired'`. The
  `'error'` value was never emitted by the game client and has been removed.
- `iframe.exit_request` is documented as fire-and-forget: the reply (`ack`) is
  optional and does not change the game's behavior. The previous "reply within
  5 seconds or the iframe shows its own error page" statement was never true.
- **Breaking:** `IframeRoundEndPayload.net_change_minor: number` is replaced by
  `net_change_micro: string` — the net change in micro-units (1 currency unit =
  1,000,000) as a decimal-integer string. Micro-unit amounts on high-denomination
  currencies exceed `Number.MAX_SAFE_INTEGER`; parse with `BigInt`. `currency` is
  unchanged.
- Default iframe `title` is now `"Hashrace Game"`; popup window title is `"Hashrace"`.
- README marks which upstream events the game client does not emit yet, and that
  the iframe does not consume downstream events yet.

### Fixed

- `PartnerClient.send()` no longer throws in non-secure contexts (plain `http`
  test pages, older WebViews) where `crypto.randomUUID` is undefined. It falls
  back to a random string, same as `PopupHandle.send()` already did.

## 0.2.0

### Added

- `launchInPopup(options)` helper for popup-window game launch (PG SOFT-style).
  Opens a Hashrace-controlled `about:blank` wrapper window, injects a relay
  iframe + script, and exposes a `PopupHandle` whose `on/off/send` surface
  matches `PartnerClient`. Handles popup blockers, cross-window relaying of
  `hashrace.v1` envelopes, and `onClosed` lifecycle.
- `DEFAULT_IFRAME_ALLOW` constant exported with value
  `'web-share *; clipboard-write *; screen-wake-lock *; fullscreen *'` —
  aligns with PG Soft / Pragmatic Play baseline so the four standard B2B
  iframe permissions are on by default.
- `embedHashraceIframe` auto-injects the `allow` attribute using
  `DEFAULT_IFRAME_ALLOW`. Callers can override via the new `iframeAllow`
  option; passing `''` opts out of the attribute entirely.
- `createPartnerClient(opts)` factory with strict origin + source + channel
  validation.
- `embedHashraceIframe(opts)` one-shot helper that creates an iframe with
  secure attributes (`referrerpolicy=strict-origin-when-cross-origin`) and
  returns a paired client.
- Compile-time and runtime rejection of forbidden downstream events
  (financial / session / game-control).
- Typed event schema for all `iframe.*` upstream and `parent.*` downstream
  events.
- `iframe.exit_request` ack mechanism with nonce correlation.
- ESM + CJS + `.d.ts` dual build via tsup; < 5 KB gzipped; zero runtime
  dependencies.
