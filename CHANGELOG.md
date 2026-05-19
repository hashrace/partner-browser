# Changelog

All notable changes to `@hashrace/partner-browser` are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0 — 2026-05-19

### Renamed

- **BREAKING (package name only)**: Renamed from `@hashrace/partner-sdk` to
  `@hashrace/partner-browser`. API surface unchanged — only the package name +
  import path change. Browser SDK is now namespaced separately from future
  server SDKs (`@hashrace/partner-node`, `@hashrace/partner-go`, etc., following
  the Stripe/Plaid/Twilio convention).

### Distribution

- **No longer published to npm registry**. Switched to GitHub git-ref install:
  consumer adds `"@hashrace/partner-browser": "github:hashrace/hashmach-partner-browser#vX.Y.Z"`
  to `dependencies` and npm/yarn/pnpm clones the repo at the tag, runs the
  `prepare` script (`npm run build`, ~2s tsup), packs `dist/` + metadata
  per `files` field, installs into `node_modules`. No npm org / NPM_TOKEN /
  separate dist mirror repo needed.

### Added

- `launchInPopup(options)` helper for popup-window game launch (PG SOFT-style).
  Opens an HashMach-controlled `about:blank` wrapper window, injects a relay
  iframe + script, and exposes a `PopupHandle` whose `on/off/send` surface
  matches `PartnerClient`. Handles popup blockers, cross-window relaying of
  `hashrace.v1` envelopes, and `onClosed` lifecycle.
- `DEFAULT_IFRAME_ALLOW` constant exported with value
  `'web-share *; clipboard-write *; screen-wake-lock *; fullscreen *'` — aligns
  with PG Soft / Pragmatic Play baseline so the four standard B2B iframe
  permissions are on by default.
- `embedHashraceIframe` now auto-injects the `allow` attribute using
  `DEFAULT_IFRAME_ALLOW`. The previous default `'payment; fullscreen'` is
  replaced. Callers can override via the new `iframeAllow` option; passing
  `''` opts out of the attribute entirely.

### Compatibility

- All 0.1.x API surface (`createPartnerClient` / `embedHashraceIframe` base
  shape) remains source-compatible. The only mandatory migrations are:
  1. Package source: previously not published; now via
     `"@hashrace/partner-browser": "github:hashrace/hashmach-partner-browser#v0.2.0"`
  2. Import path: `@hashrace/partner-sdk` → `@hashrace/partner-browser`
- The `allow` attribute string emitted by `embedHashraceIframe` now defaults
  to the four-permission baseline above. Partners who depended on the prior
  `'payment; fullscreen'` shape must pass `iframeAllow: 'payment; fullscreen'`
  explicitly, or merge the values they need.
- New `iframeAllow` parameter on `embedHashraceIframe` is optional.

## 0.1.0 — 2026-04-22 (published as `@hashrace/partner-sdk`)

### Added

- Initial release implementing the `hashrace.v1` postMessage channel.
- `createPartnerClient(opts)` factory with strict origin + source + channel validation.
- `embedHashraceIframe(opts)` one-shot helper that creates an iframe with secure
  attributes (`referrerpolicy=strict-origin-when-cross-origin`, `allow=payment; fullscreen`)
  and returns a paired client.
- Compile-time and runtime rejection of forbidden downstream events
  (financial / session / game-control).
- Typed event schema for all `iframe.*` upstream and `parent.*` downstream events.
- `iframe.exit_request` ack mechanism with nonce correlation.
- ESM + CJS + `.d.ts` dual build via tsup; < 5 KB gzipped; zero runtime deps.
