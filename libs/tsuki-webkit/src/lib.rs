// tsuki-webkit — lib.rs
// JSX → HTML/CSS/JS compiler for ESP8266/ESP32 control panels
// Written from scratch in Rust with no external dependencies.

pub mod config;
pub mod lexer;
pub mod parser;
pub mod codegen;
pub mod injector;
pub mod error;

pub use config::WebkitConfig;
pub use error::WebkitError;

use std::path::Path;

/// Output of a successful Webkit compilation.
#[derive(Debug, Clone)]
pub struct WebkitOutput {
    /// Inlined HTML page (includes <style> and <script> tags)
    pub html: String,
    /// The C++ source that embeds the HTML as a PROGMEM string
    /// and wires up the WebServer routes.
    pub cpp_fragment: String,
}

/// Compile a `.jsx` source file into embedded HTML + a C++ fragment.
///
/// # Arguments
/// * `jsx_src`  — contents of the entry `app.jsx`
/// * `config`   — parsed `tsuki-webkit.conf.json`
/// * `board`    — target board id (e.g. `"esp8266"`, `"esp32"`)
pub fn compile(
    jsx_src:  &str,
    config:   &WebkitConfig,
    board:    &str,
) -> Result<WebkitOutput, WebkitError> {
    // 1. Lex + parse JSX into an AST
    let tokens = lexer::tokenize(jsx_src)?;
    let ast    = parser::parse(tokens)?;

    // 2. Generate HTML/CSS/JS from the AST
    let (html, css, js) = codegen::generate(&ast, config)?;

    // 3. Bundle into a single self-contained HTML page
    let page = bundle_page(&html, &css, &js, config);

    // 4. Produce the C++ fragment that embeds and serves the page
    let cpp_fragment = injector::inject(&page, board, config);

    Ok(WebkitOutput { html: page, cpp_fragment })
}

/// Bundle HTML + CSS + JS into a single page string.
fn bundle_page(html: &str, css: &str, js: &str, cfg: &WebkitConfig) -> String {
    let title = cfg.name.as_deref().unwrap_or("Tsuki App");
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px}}
{css}
</style>
</head>
<body>
{html}
<script>
(function(){{
const _api={{
  get:function(path,cb){{fetch(path).then(r=>r.json()).then(cb).catch(console.error)}},
  post:function(path,body,cb){{fetch(path,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(body)}}).then(r=>r.json()).then(cb).catch(console.error)}},
}};
const _serial={{
  log:function(msg){{var el=document.getElementById('__serial_log');if(el){{el.textContent+=msg+'\n';el.scrollTop=el.scrollHeight}}}},
}};
{js}
}})();
</script>
</body>
</html>"#,
        title = title,
        css   = css,
        html  = html,
        js    = js,
    )
}
