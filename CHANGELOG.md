# Changelog

All notable changes to `@hashrace/partner-sdk` are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 — 2026-04-22

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
