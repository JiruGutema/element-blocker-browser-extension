# Generating the Firefox XPI

An `.xpi` is just a **ZIP archive with `manifest.json` at its root** (not inside a
subfolder). Firefox also needs a stable add-on ID to sign or permanently install
it — that lives in the Firefox manifest under `browser_specific_settings.gecko.id`
(`element-blocker@jirugutema`).

There are three ways to produce the XPI, from quickest to most official.

---

## Method 1 — `build.sh` (quickest, unsigned)

The build script already assembles `dist/firefox/` and zips it into a valid XPI:

```bash
./build.sh
# → dist/element-blocker.xpi
```

Under the hood it runs the equivalent of:


> The `cd` matters: zipping from **inside** `dist/firefox` puts `manifest.json` at
> the archive root. Zipping the folder itself (`zip -r out.xpi dist/firefox`) nests
> everything under `firefox/` and Firefox will reject it.

This XPI is **unsigned** — good for temporary loading and for Developer/Nightly
builds (see *Installing*), but not for permanent install on release Firefox.

---

## Method 2 — `web-ext` (recommended: lints, builds, and signs)

[`web-ext`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
is Mozilla's official tool. Install it once:

```bash
npm install -g web-ext
```

**Lint** (catches manifest and API problems before you ship):

```bash
web-ext lint --source-dir dist/firefox
```

**Live-run** in a scratch Firefox profile with auto-reload while you edit:

```bash
web-ext run --source-dir dist/firefox
```

**Build** an unsigned package:

```bash
web-ext build --source-dir dist/firefox --artifacts-dir dist
# → dist/element_blocker-1.0.zip   (rename to .xpi if you like)
```

**Sign** a distributable XPI through Mozilla's Add-on service (AMO). Create API
credentials at <https://addons.mozilla.org/developers/addon/api/key/>, then:

```bash
web-ext sign \
  --source-dir dist/firefox \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET" \
  --channel unlisted        # 'unlisted' = self-distribute; 'listed' = publish on AMO
# → a signed .xpi in ./web-ext-artifacts/ that installs on any Firefox
```

Signing requires the `gecko.id` — already set in `manifests/manifest.firefox.json`.

---

## Method 3 — plain `zip` (no tooling)

```bash
cd dist/firefox
zip -r -FS ../../element-blocker.xpi . -x '*.DS_Store'
```

Same result as Method 1, done by hand.

---

## Installing the XPI

| Goal | How | Signing needed? |
|------|-----|-----------------|
| **Quick test** | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist/firefox/manifest.json` **or** the `.xpi`. Gone on restart. | No |
| **Permanent, unsigned** | Firefox **Developer Edition / Nightly / ESR** only: set `xpinstall.signatures.required` to `false` in `about:config`, then `about:addons` → gear → **Install Add-on From File** → select the `.xpi`. | No |
| **Permanent, any Firefox** | Sign via `web-ext sign` (Method 2), then `about:addons` → **Install Add-on From File** → select the signed `.xpi`. | Yes (AMO) |

> Release and Beta Firefox **refuse unsigned add-ons** — that's why permanent
> install there needs Method 2's signing step. `about:debugging` bypasses this for
> testing because the install is temporary.

---

## Troubleshooting

- **"This add-on could not be installed because it appears to be corrupt"** — the
  manifest isn't at the archive root. Re-zip from *inside* `dist/firefox`.
- **"This add-on could not be installed because it has not been verified"** —
  it's unsigned on release Firefox. Use `about:debugging` to test, or sign it.
- **Lint warnings about permissions** — `activeTab`/`tabs`/`storage` are all valid;
  `web-ext lint` should pass clean for this extension.
