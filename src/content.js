// Element Blocker — content script
// Injects a stylesheet that force-hides every element matching the user's
// stored selectors, and provides a click-to-pick mode for grabbing selectors
// straight off the page. Runs at document_start so blocked elements never flash.

const api = globalThis.browser ?? globalThis.chrome;

const STORAGE_KEY = "elementBlocker";
const STYLE_ID = "__element-blocker-style";
const HIGHLIGHT_ID = "__element-blocker-highlight";
const TOAST_ID = "__element-blocker-toast";

const HOST = location.hostname;
const IS_TOP_FRAME = window.top === window;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const emptyState = () => ({ paused: false, rules: [] });

async function getState() {
  try {
    const stored = await api.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? emptyState();
  } catch (err) {
    console.error("[Element Blocker] failed to read state:", err);
    return emptyState();
  }
}

async function setState(next) {
  try {
    await api.storage.local.set({ [STORAGE_KEY]: next });
  } catch (err) {
    console.error("[Element Blocker] failed to write state:", err);
  }
}

// ---------------------------------------------------------------------------
// Rule application (force-hide via injected stylesheet)
// ---------------------------------------------------------------------------

function ruleAppliesHere(rule) {
  if (!rule || rule.enabled === false || !rule.selector) return false;
  if (rule.scope === "global") return true;
  return rule.scope === "site" && rule.site === HOST;
}

function buildCss(rules) {
  // One block per selector so a single malformed selector can't disable the rest.
  return rules
    .filter(ruleAppliesHere)
    .map((rule) => rule.selector.trim())
    .filter(Boolean)
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");
}

function applyState(state) {
  const root = document.head || document.documentElement;
  if (!root) return;

  let style = document.getElementById(STYLE_ID);

  if (!state || state.paused) {
    if (style) style.remove();
    return;
  }

  const css = buildCss(state.rules ?? []);
  if (!css) {
    if (style) style.remove();
    return;
  }

  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    root.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

async function refresh() {
  applyState(await getState());
}

// Re-apply on every stored change (popup edits, picks from other tabs, etc.).
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    applyState(changes[STORAGE_KEY].newValue);
  }
});

// ---------------------------------------------------------------------------
// Element picker
// ---------------------------------------------------------------------------

function isMeaningfulClass(name) {
  // Skip framework hash/state classes that won't be stable across reloads.
  if (!name) return false;
  if (name.length > 40) return false;
  if (/^(css-|sc-|jsx-|ng-|is-|has-)/.test(name)) return false;
  if (/[0-9]{4,}/.test(name)) return false;
  return true;
}

function selectorForNode(node) {
  const tag = node.tagName.toLowerCase();
  const classes = Array.from(node.classList).filter(isMeaningfulClass).slice(0, 2);
  if (classes.length) {
    return tag + classes.map((c) => `.${CSS.escape(c)}`).join("");
  }
  const parent = node.parentElement;
  if (parent) {
    const twins = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
    if (twins.length > 1) return `${tag}:nth-of-type(${twins.indexOf(node) + 1})`;
  }
  return tag;
}

// Build the shortest reliable selector for an element: prefer #id, then walk up
// stacking class/tag parts until the path resolves to a single element.
function generateSelector(el) {
  if (el.id) {
    const byId = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelectorAll(byId).length === 1) return byId;
    } catch {
      /* invalid id chars — fall through to path building */
    }
  }

  const parts = [];
  let node = el;
  const MAX_DEPTH = 5;

  while (node && node.nodeType === 1 && node !== document.documentElement) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    parts.unshift(selectorForNode(node));
    const candidate = parts.join(" > ");
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      /* keep climbing */
    }
    if (parts.length >= MAX_DEPTH) break;
    node = node.parentElement;
  }
  return parts.join(" > ");
}

let picking = false;
let hoveredEl = null;

function highlightBox() {
  let box = document.getElementById(HIGHLIGHT_ID);
  if (!box) {
    box = document.createElement("div");
    box.id = HIGHLIGHT_ID;
    Object.assign(box.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      background: "rgba(255, 92, 26, 0.18)",
      border: "2px solid #17130b",
      borderRadius: "2px",
      boxShadow: "3px 3px 0 #ff5c1a",
      transition: "all 60ms ease-out",
      display: "none",
    });
    document.documentElement.appendChild(box);
  }
  return box;
}

function moveHighlight(el) {
  const box = highlightBox();
  const rect = el.getBoundingClientRect();
  Object.assign(box.style, {
    display: "block",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

function isOwnUi(el) {
  return el.closest(`#${HIGHLIGHT_ID}, #${TOAST_ID}`) != null;
}

function onPickMove(event) {
  const el = event.target;
  if (!el || isOwnUi(el)) return;
  hoveredEl = el;
  moveHighlight(el);
}

function onPickKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    stopPick();
    toast("Pick cancelled", false);
  }
}

function onPickClick(event) {
  event.preventDefault();
  event.stopPropagation();
  const el = hoveredEl || event.target;
  if (!el || isOwnUi(el)) return;
  const selector = generateSelector(el);
  stopPick();
  if (selector) addSiteRule(selector);
}

function startPick() {
  if (!IS_TOP_FRAME || picking) return;
  picking = true;
  highlightBox().style.display = "none";
  document.addEventListener("mousemove", onPickMove, true);
  document.addEventListener("click", onPickClick, true);
  document.addEventListener("keydown", onPickKey, true);
  toast("Click an element to block it · Esc to cancel", true);
}

function stopPick() {
  picking = false;
  hoveredEl = null;
  document.removeEventListener("mousemove", onPickMove, true);
  document.removeEventListener("click", onPickClick, true);
  document.removeEventListener("keydown", onPickKey, true);
  const box = document.getElementById(HIGHLIGHT_ID);
  if (box) box.style.display = "none";
}

async function addSiteRule(selector) {
  const state = await getState();
  const rules = state.rules ?? [];
  const isDuplicate = rules.some(
    (r) => r.selector === selector && r.scope === "site" && r.site === HOST
  );
  if (isDuplicate) {
    toast(`Already blocking ${selector}`, false);
    return;
  }
  const rule = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    selector,
    scope: "site",
    site: HOST,
    enabled: true,
    createdAt: Date.now(),
  };
  await setState({ ...state, rules: [...rules, rule] });
  toast(`Blocked ${selector}`, true);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = null;

function toast(message, positive) {
  if (!IS_TOP_FRAME) return;
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = TOAST_ID;
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "2147483647",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "12px 16px",
      borderRadius: "3px",
      border: "2px solid #17130b",
      font: "700 13px/1.4 system-ui, sans-serif",
      boxShadow: "4px 4px 0 #17130b",
      pointerEvents: "none",
      maxWidth: "80vw",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    document.documentElement.appendChild(el);
  }
  el.style.background = positive ? "#ff5c1a" : "#17130b";
  el.style.color = positive ? "#17130b" : "#f7f3e9";
  el.textContent = message;
  el.style.opacity = "1";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.transition = "opacity 300ms ease";
    el.style.opacity = "0";
  }, 2200);
}

// ---------------------------------------------------------------------------
// Messaging from popup
// ---------------------------------------------------------------------------

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === "startPick") {
    startPick();
    sendResponse({ ok: IS_TOP_FRAME });
  }
  return true;
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

refresh();
// document_start can run before <head>; re-apply once the DOM is parsed so the
// stylesheet lands even if the first pass had no mount point.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", refresh, { once: true });
}
