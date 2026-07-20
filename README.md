# Content Section Blocker

Force-hide any element on any website by CSS selector (class or id). Rules are
editable and stored locally, per-site by default, or globally across all sites.

## What it does

- **Block by selector**: paste a selector like `.ad-container` or `#promoted-post` and the matching element is force-hidden with `display: none !important`.
- **Pick an element**: click _Pick an element on the page_, then click any element; the extension generates a selector (preferring its `id`) and blocks it instantly.
- **Per-site or global**: a rule tagged _This site_ only fires on the domain you added it on; _All sites_ rules fire everywhere.
- **Fully editable**: toggle any rule on/off, click a selector to edit it, or delete it. Everything persists in `storage.local`.
- **Master switch**: pause or resume all blocking from the popup header.

Rules are injected as a stylesheet at `document_start`, so blocked elements never
flash before being hidden, and dynamically-added elements are hidden too — no
per-node scanning required.

## Build

```bash
./build.sh
```

This produces `dist/chrome/` and `dist/firefox/` (unpacked, directly loadable)
plus the packaged `content-section-blocker.xpi` and `content-section-blocker-chrome.zip`.

## Install

### Chrome / Edge

1. `./build.sh`
2. Open `chrome://extensions` and enable **Developer mode**
3. **Load unpacked** → select `dist/chrome/`

### Firefox (temporary)

1. `./build.sh`
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on…** → select `dist/firefox/manifest.json` (or `dist/content-section-blocker.xpi`)

### You can get published extension for Firefox
- [firefox addon page](https://addons.mozilla.org/en-US/developers/addon/content-section-blocker)

## How to use

1. Click the toolbar icon to open the popup.
2. Either:
   - Click **Pick an element on the page**, then click the element to block, or
   - Paste a CSS selector, choose **This site** or **All sites**, and click **Block**.
3. Manage rules in the list: `◉`/`○` toggles a rule, `✕` deletes it, and clicking
   the selector text lets you edit it.

## Cross-browser notes

- Both builds are Manifest V3 and share one codebase; `content.js` and `popup.js`
  use `globalThis.browser ?? globalThis.chrome`, so they get promise-based APIs on
  both Firefox (`browser.*`) and Chrome (`chrome.*`).
- Firefox's manifest adds `browser_specific_settings.gecko` (add-on ID + minimum
  version) — required to sign and permanently install the XPI. Chrome ignores it.
