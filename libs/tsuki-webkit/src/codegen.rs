// tsuki-webkit — codegen.rs
// Walks the AST and emits minified HTML + baseline CSS + JS.

use crate::error::WebkitError;
use crate::parser::{JsxNode, JsxAttr, AttrValue, Module};
use crate::config::WebkitConfig;

// ── HTML generation ───────────────────────────────────────────────────────────

fn render_node(node: &JsxNode, out: &mut String, js_handlers: &mut String) {
    match node {
        JsxNode::Text(t) => out.push_str(t),
        JsxNode::Expr(e) => {
            // Inline expressions rendered as span with data-expr
            out.push_str(&format!("<span data-expr=\"{}\">{}</span>", e, e));
        }
        JsxNode::Fragment(children) => {
            for child in children { render_node(child, out, js_handlers); }
        }
        JsxNode::Element { tag, attrs, children } => {
            // Map JSX tag names to HTML equivalents
            let html_tag = jsx_tag_to_html(tag);

            out.push('<');
            out.push_str(&html_tag);

            let mut id_attr = None::<String>;

            for attr in attrs {
                match attr.name.as_str() {
                    // Event handlers → extract to JS
                    n if n.starts_with("on") => {
                        if let Some(AttrValue::Expr(expr)) = &attr.value {
                            let id = format!("__wk_{}", rand_id(tag, n));
                            id_attr = Some(id.clone());
                            let event = &n[2..].to_lowercase();
                            js_handlers.push_str(&format!(
                                "document.getElementById('{id}')?.addEventListener('{event}', function(e){{{expr}}});\n"
                            ));
                        }
                    }
                    // className → class
                    "className" => {
                        if let Some(v) = attr_value_str(&attr.value) {
                            out.push_str(&format!(" class=\"{v}\""));
                        }
                    }
                    // htmlFor → for
                    "htmlFor" => {
                        if let Some(v) = attr_value_str(&attr.value) {
                            out.push_str(&format!(" for=\"{v}\""));
                        }
                    }
                    // Standard pass-through attributes
                    _ => {
                        if let Some(v) = attr_value_str(&attr.value) {
                            out.push_str(&format!(" {}=\"{}\"", attr.name, v));
                        } else {
                            out.push(' ');
                            out.push_str(&attr.name);
                        }
                    }
                }
            }

            // Inject id for event handler
            if let Some(id) = &id_attr {
                out.push_str(&format!(" id=\"{id}\""));
            }

            if is_void_element(&html_tag) {
                out.push_str("/>");
                return;
            }

            out.push('>');

            for child in children {
                render_node(child, out, js_handlers);
            }

            out.push_str("</");
            out.push_str(&html_tag);
            out.push('>');
        }
    }
}

fn jsx_tag_to_html(tag: &str) -> String {
    // Lower-case tags are HTML; upper-case are React components → render as div
    if tag.starts_with(|c: char| c.is_uppercase()) {
        "div".into()
    } else {
        tag.to_owned()
    }
}

fn attr_value_str(val: &Option<AttrValue>) -> Option<String> {
    match val {
        Some(AttrValue::Str(s)) => Some(s.clone()),
        Some(AttrValue::Expr(e)) => Some(e.clone()),
        None => None,
    }
}

fn is_void_element(tag: &str) -> bool {
    matches!(tag, "area"|"base"|"br"|"col"|"embed"|"hr"|"img"|"input"|"link"|"meta"|"param"|"source"|"track"|"wbr")
}

/// Deterministic-ish short id from tag + attr name (no rand dep)
fn rand_id(tag: &str, attr: &str) -> String {
    let mut h: u64 = 5381;
    for c in tag.bytes().chain(attr.bytes()) {
        h = h.wrapping_mul(33).wrapping_add(c as u64);
    }
    format!("{h:x}")
}

// ── CSS baseline ──────────────────────────────────────────────────────────────

fn generate_css() -> String {
    r#"
.wk-card{background:#1e293b;border-radius:8px;padding:12px;margin:8px 0;border:1px solid #334155}
.wk-btn{background:#3b82f6;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:14px}
.wk-btn:hover{background:#2563eb}
.wk-btn:active{background:#1d4ed8}
.wk-input{background:#0f172a;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:6px 10px;font-size:14px;width:100%}
.wk-label{font-size:12px;color:#94a3b8;margin-bottom:4px;display:block}
.wk-badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:#1e293b;border:1px solid #334155}
.wk-row{display:flex;align-items:center;gap:8px}
.wk-col{display:flex;flex-direction:column;gap:4px}
.wk-serial{background:#020617;font-family:monospace;font-size:12px;color:#4ade80;padding:8px;border-radius:6px;height:120px;overflow-y:auto;white-space:pre-wrap}
h1,h2,h3{font-weight:600;line-height:1.3}
h1{font-size:1.4rem;margin-bottom:8px}
h2{font-size:1.1rem;margin-bottom:6px}
p{line-height:1.5;color:#cbd5e1}
"#.trim().into()
}

// ── JS runtime helpers (Api, Json, Serial) ────────────────────────────────────

fn generate_runtime_js(imports: &[crate::parser::ImportDecl]) -> String {
    let mut js = String::new();

    let wants_api    = imports.iter().any(|i| i.source == "tsuki-webkit" && i.names.contains(&"Api".into()));
    let wants_json   = imports.iter().any(|i| i.source == "tsuki-webkit" && i.names.contains(&"Json".into()));
    let wants_serial = imports.iter().any(|i| i.source == "tsuki-webkit" && i.names.contains(&"Serial".into()));

    if wants_api {
        js.push_str(r#"
var Api={
  get:function(p,cb){fetch(p).then(function(r){return r.json()}).then(cb).catch(console.error)},
  post:function(p,body,cb){fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(cb).catch(console.error)},
  poll:function(p,cb,ms){cb&&Api.get(p,cb);setInterval(function(){Api.get(p,cb)},ms||2000)}
};
"#);
    }

    if wants_json {
        js.push_str("var Json={parse:JSON.parse,stringify:JSON.stringify};\n");
    }

    if wants_serial {
        js.push_str(r#"
var Serial={
  log:function(msg){var el=document.getElementById('__serial_log');if(el){el.textContent+=msg+'\n';el.scrollTop=el.scrollHeight}},
  read:function(cb){Api.get('/serial',function(d){cb&&cb(d.data)})},
  write:function(msg){Api.post('/serial',{data:msg},null)}
};
"#);
    }

    js
}

// ── Public entry-point ────────────────────────────────────────────────────────

pub fn generate(module: &Module, _cfg: &WebkitConfig) -> Result<(String, String, String), WebkitError> {
    let mut html        = String::new();
    let mut js_handlers = String::new();

    if let Some(root) = &module.jsx_root {
        render_node(root, &mut html, &mut js_handlers);
    }

    let css = generate_css();
    let mut js = generate_runtime_js(&module.imports);
    js.push_str(&js_handlers);

    // Append captured JS statements (state vars, etc.)
    for stmt in &module.js_stmts {
        if !stmt.trim().is_empty() {
            js.push_str(stmt);
            js.push('\n');
        }
    }

    Ok((html, css, js))
}
