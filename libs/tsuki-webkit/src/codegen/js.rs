// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: codegen :: js
//  Generates the browser-side JavaScript bundle.
//  Handles:
//    - Serial.read() / Serial.write()  → WebSocket to /ws endpoint
//    - Json.parse() / Json.stringify() → native JSON
//    - Dynamic expression bindings for {expr} placeholders
// ─────────────────────────────────────────────────────────────────────────────

use crate::jsx::ast::{WebkitImport, JsxNode};

/// Checks if the imports use a given name from tsuki-webkit.
fn uses(imports: &[WebkitImport], name: &str) -> bool {
    imports.iter()
        .filter(|i| i.from == "tsuki-webkit")
        .any(|i| i.names.iter().any(|n| n == name))
}

/// Generate the complete browser JS bundle.
pub fn generate(imports: &[WebkitImport], client_js: &str, root: &JsxNode) -> String {
    let mut js = String::new();

    js.push_str("// tsuki-webkit — auto-generated browser bundle\n");
    js.push_str("'use strict';\n\n");

    // ── Json shim ─────────────────────────────────────────────────────────────
    if uses(imports, "Json") {
        js.push_str(JSON_SHIM);
    }

    // ── Serial WebSocket bridge ───────────────────────────────────────────────
    if uses(imports, "Serial") {
        js.push_str(SERIAL_BRIDGE);
    }

    // ── Api fetch helpers ─────────────────────────────────────────────────────
    if uses(imports, "Api") {
        js.push_str(API_CLIENT);
    }

    // ── Expression hydration ──────────────────────────────────────────────────
    js.push_str(EXPR_HYDRATION);

    // ── User client JS (non-Api logic from the component) ─────────────────────
    if !client_js.trim().is_empty() {
        js.push_str("\n// --- Component logic ---\n");
        js.push_str(client_js);
        js.push('\n');
    }

    js
}

// ─── Embedded JS snippets ─────────────────────────────────────────────────────

const JSON_SHIM: &str = r#"
// Json — thin wrapper around native JSON
const Json = {
  parse:     (s) => JSON.parse(s),
  stringify: (v) => JSON.stringify(v),
};
"#;

const SERIAL_BRIDGE: &str = r#"
// Serial — WebSocket bridge to /ws on the device
const Serial = (() => {
  let _ws = null;
  const _listeners = [];

  function _connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    _ws = new WebSocket(`${proto}://${location.host}/ws`);
    _ws.onmessage = (e) => _listeners.forEach(fn => fn(e.data));
    _ws.onclose   = () => setTimeout(_connect, 2000);
  }

  _connect();

  return {
    write: (data) => {
      if (_ws && _ws.readyState === 1) _ws.send(data);
    },
    onData: (fn) => _listeners.push(fn),
    read:   () => null, // async — use onData() instead
  };
})();
"#;

const API_CLIENT: &str = r#"
// Api — fetch helpers that mirror the server-side Api.get / Api.post
const Api = {
  get:  async (path, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const r   = await fetch(qs ? `${path}?${qs}` : path);
    return r.json().catch(() => r.text());
  },
  post: async (path, body = {}) => {
    const r = await fetch(path, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    return r.json().catch(() => r.text());
  },
};
"#;

const EXPR_HYDRATION: &str = r#"
// Hydrate data-expr spans with live values fetched from /api/state
async function _tsukiHydrate() {
  const spans = document.querySelectorAll('[data-expr]');
  if (!spans.length) return;
  try {
    const state = await fetch('/api/state').then(r => r.json());
    spans.forEach(span => {
      const key = span.dataset.expr.trim();
      if (key in state) span.textContent = state[key];
    });
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  _tsukiHydrate();
  setInterval(_tsukiHydrate, 2000); // poll every 2s
});
"#;