// Element Blocker — popup controller
// Reads/writes the locally-stored rule list and renders the rules relevant to
// the active tab (this-site rules + all global rules). All state updates are
// immutable: build a new object and hand it to setState.

const api = globalThis.browser ?? globalThis.chrome;
const STORAGE_KEY = "elementBlocker";
const PAGE_SIZE = 5;

const els = {
  siteLabel: document.getElementById("site-label"),
  masterToggle: document.getElementById("master-toggle"),
  pickBtn: document.getElementById("pick-btn"),
  form: document.getElementById("add-form"),
  input: document.getElementById("selector-input"),
  scopeToggle: document.querySelector(".scope-toggle"),
  addBtn: document.getElementById("add-btn"),
  error: document.getElementById("form-error"),
  emptyState: document.getElementById("empty-state"),
  list: document.getElementById("rule-list"),
  count: document.getElementById("count-label"),
  clearSite: document.getElementById("clear-site"),
  pager: document.getElementById("pager"),
  pagerLabel: document.getElementById("pager-label"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
};

const ctx = {
  host: "",
  url: "",
  canUseSite: false,
  tabId: null,
  scope: "site",
  clearArmed: false,
  page: 0,
  focusId: null,
};

// ---------------------------------------------------------------- state I/O

async function getState() {
  const stored = await api.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? { paused: false, rules: [] };
}

async function setState(next) {
  await api.storage.local.set({ [STORAGE_KEY]: next });
}

async function mutateRules(updater) {
  const state = await getState();
  const nextRules = updater(state.rules ?? []);
  await setState({ ...state, rules: nextRules });
  await render();
}

// --------------------------------------------------------------- validation

function validateSelector(selector) {
  const trimmed = selector.trim();
  if (!trimmed) return { ok: false, error: "Enter a selector first." };
  try {
    document.querySelector(trimmed);
  } catch {
    return { ok: false, error: "That isn't a valid CSS selector." };
  }
  return { ok: true, value: trimmed };
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

// ------------------------------------------------------------------- render

function ruleIsVisibleHere(rule) {
  if (rule.scope === "global") return true;
  return rule.scope === "site" && rule.site === ctx.host;
}

function makeIconBtn(className, symbol, title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `icon-btn ${className}`;
  btn.textContent = symbol;
  btn.title = title;
  return btn;
}

function renderRule(rule) {
  const li = document.createElement("li");
  li.className = "rule" + (rule.enabled === false ? " is-disabled" : "");
  li.dataset.id = rule.id;

  const dot = document.createElement("span");
  dot.className = "rule-dot";

  const selector = document.createElement("span");
  selector.className = "rule-selector";
  selector.textContent = rule.selector;
  selector.title = "Click to edit";
  selector.addEventListener("click", () => startEdit(li, rule));

  const badge = document.createElement("span");
  badge.className = "badge " + (rule.scope === "global" ? "badge-global" : "badge-site");
  badge.textContent = rule.scope === "global" ? "all" : "site";

  const toggle = makeIconBtn(
    "toggle",
    rule.enabled === false ? "○" : "◉",
    rule.enabled === false ? "Enable rule" : "Disable rule"
  );
  toggle.addEventListener("click", () =>
    mutateRules((rules) =>
      rules.map((r) => (r.id === rule.id ? { ...r, enabled: r.enabled === false } : r))
    )
  );

  const del = makeIconBtn("del", "✕", "Delete rule");
  del.addEventListener("click", () =>
    mutateRules((rules) => rules.filter((r) => r.id !== rule.id))
  );

  li.append(dot, selector, badge, toggle, del);
  return li;
}

function startEdit(li, rule) {
  const current = li.querySelector(".rule-selector");
  if (!current || li.querySelector(".rule-edit-input")) return;

  const input = document.createElement("input");
  input.className = "rule-edit-input";
  input.value = rule.selector;
  input.spellcheck = false;
  current.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const result = validateSelector(input.value);
    if (!result.ok) {
      input.style.borderColor = "var(--danger)";
      return;
    }
    if (result.value === rule.selector) {
      await render();
      return;
    }
    await mutateRules((rules) =>
      rules.map((r) => (r.id === rule.id ? { ...r, selector: result.value } : r))
    );
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      render();
    }
  });
  input.addEventListener("blur", commit);
}

async function render() {
  const state = await getState();
  const rules = state.rules ?? [];

  els.masterToggle.checked = !state.paused;

  const visible = rules
    .filter(ruleIsVisibleHere)
    .sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "site" ? -1 : 1;
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });

  els.list.replaceChildren(...visible.map(renderRule));
  els.emptyState.hidden = visible.length > 0;

  const siteCount = rules.filter((r) => r.scope === "site" && r.site === ctx.host).length;
  const globalCount = rules.filter((r) => r.scope === "global").length;
  els.count.textContent = `${visible.length} active here · ${globalCount} global`;
  els.clearSite.hidden = siteCount === 0;
}

// ------------------------------------------------------------------ actions

async function addRule(selector, scope) {
  const rule = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    selector,
    scope,
    site: scope === "site" ? ctx.host : null,
    enabled: true,
    createdAt: Date.now(),
  };
  await mutateRules((rules) => {
    const isDuplicate = rules.some(
      (r) => r.selector === selector && r.scope === scope && r.site === rule.site
    );
    return isDuplicate ? rules : [...rules, rule];
  });
}

function setScope(scope) {
  ctx.scope = scope;
  els.scopeToggle.querySelectorAll(".scope-opt").forEach((opt) => {
    const active = opt.dataset.scope === scope;
    opt.classList.toggle("is-active", active);
    opt.setAttribute("aria-checked", String(active));
  });
}

async function startPicking() {
  if (!ctx.tabId) return;
  try {
    await api.tabs.sendMessage(ctx.tabId, { action: "startPick" });
    window.close(); // get out of the way so the user can click the page
  } catch {
    showError("Can't pick on this page. Try a normal website tab.");
  }
}

// -------------------------------------------------------------------- setup

function wireEvents() {
  els.masterToggle.addEventListener("change", async () => {
    const state = await getState();
    await setState({ ...state, paused: !els.masterToggle.checked });
  });

  els.pickBtn.addEventListener("click", startPicking);

  els.scopeToggle.addEventListener("click", (e) => {
    const opt = e.target.closest(".scope-opt");
    if (opt) setScope(opt.dataset.scope);
  });

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = validateSelector(els.input.value);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    showError("");
    await addRule(result.value, ctx.scope);
    els.input.value = "";
    els.input.focus();
  });

  els.input.addEventListener("input", () => showError(""));

  els.clearSite.addEventListener("click", async () => {
    if (!ctx.clearArmed) {
      ctx.clearArmed = true;
      els.clearSite.textContent = "Tap again to confirm";
      setTimeout(() => {
        ctx.clearArmed = false;
        els.clearSite.textContent = "Clear this site";
      }, 2500);
      return;
    }
    ctx.clearArmed = false;
    els.clearSite.textContent = "Clear this site";
    await mutateRules((rules) =>
      rules.filter((r) => !(r.scope === "site" && r.site === ctx.host))
    );
  });
}

async function resolveActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  ctx.tabId = tab?.id ?? null;
  ctx.url = tab?.url ?? "";
  try {
    ctx.host = new URL(ctx.url).hostname;
  } catch {
    ctx.host = "";
  }
  ctx.canUseSite = /^https?:/.test(ctx.url) && ctx.host !== "";

  if (ctx.canUseSite) {
    els.siteLabel.textContent = ctx.host;
    els.siteLabel.classList.remove("is-global");
  } else {
    els.siteLabel.textContent = "Global rules only on this page";
    els.siteLabel.classList.add("is-global");
    // No addressable site → force global scope and disable page-only features.
    setScope("global");
    els.scopeToggle.querySelector('[data-scope="site"]').disabled = true;
    els.pickBtn.disabled = true;
    els.pickBtn.style.opacity = "0.5";
    els.pickBtn.style.cursor = "not-allowed";
  }
}

async function init() {
  await resolveActiveTab();
  wireEvents();
  await render();
  els.input.focus();
}

init();
