# Changelog

All notable changes to `@hashrace/partner-browser` are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0

### Added

- `launchInPopup(options)` helper for popup-window game launch (PG SOFT-style).
  Opens an HashMach-controlled `about:blank` wrapper window, injects a relay
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
