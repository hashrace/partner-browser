# Examples

| Directory | iframe demo | popup demo |
|-----------|-------------|------------|
| `vanilla/` | `index.html` | `popup.html` |
| `react/` | `App.tsx` | `PopupApp.tsx` |
| `vue/` | `App.vue` | `PopupApp.vue` |

## Running the vanilla demos

The vanilla pages import the SDK from this repository's local build output
(`../../dist/index.mjs`), so build it first:

```bash
# from the repository root
npm ci
npm run build          # produces dist/index.mjs, dist/index.cjs, dist/index.d.ts
```

Then serve the **repository root** (not `examples/`) over HTTP, so that the
relative path `../../dist/index.mjs` resolves — ES modules do not load from `file://`:

```bash
npx serve .            # or: python3 -m http.server 8080
# open http://localhost:<port>/examples/vanilla/index.html
```

## Where the launch URL comes from

Every demo fetches the launch URL from **your own backend** (`POST /api/hashrace/launch`
is a placeholder — replace it with your real endpoint). Your backend holds the API Key,
calls Hashrace `/api/v1/partner/launch-session` for the logged-in player, and returns
the URL to the page.

Do **not** read the launch URL from the page's query string or hash. That lets any
crafted link decide what the iframe / popup loads (reflected XSS / phishing).

Launch URLs are single-use: fetch a new one for every launch.

## React / Vue: remove the iframe on cleanup

`embedHashraceIframe` appends the iframe to the container with DOM APIs, outside
React / Vue's control. Cleanup must call **both** `client.dispose()` and
`iframe.remove()`. Under React StrictMode the effect mounts twice in development;
if the first iframe is left in the DOM, both iframes redeem the same single-use
launch token and the second one fails.
