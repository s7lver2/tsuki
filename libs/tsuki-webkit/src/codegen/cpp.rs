// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-webkit :: codegen :: cpp
//  Generates the C++ header that gets injected into the Arduino sketch.
//  Output: tsuki_webkit_gen.h — #included by the transpiled main.cpp.
//
//  Structure:
//    - PROGMEM string with the full HTML page
//    - TsukiWebApp class wrapping ESP8266WebServer / WebServer (ESP32)
//    - One route per Api.get/post call found in app.jsx
//    - /api/state GET route for expression hydration
//    - /ws WebSocket handler if Serial is used
// ─────────────────────────────────────────────────────────────────────────────

use crate::jsx::ast::{JsxComponent, ApiRoute, HttpMethod};
use crate::manifest::WebkitManifest;
use crate::error::{Result, WebkitError};

pub struct CppOutput {
    /// Content of tsuki_webkit_gen.h
    pub header: String,
}

pub fn generate(comp: &JsxComponent, manifest: &WebkitManifest, html: &str, js: &str) -> Result<CppOutput> {
    let port = manifest.app.port;
    let uses_serial = comp.imports.iter()
        .filter(|i| i.from == "tsuki-webkit")
        .any(|i| i.names.iter().any(|n| n == "Serial"));

    // Escape HTML/JS for PROGMEM raw string literal: must not contain )rawstr"
    let safe_html = escape_progmem(html);
    let safe_js   = escape_progmem(js);

    let full_page = build_html_page(&manifest.name, &safe_html, &safe_js);

    let mut routes_cpp = String::new();
    for route in &comp.api_routes {
        routes_cpp.push_str(&render_route(route)?);
    }

    // /api/state route (always present for expression hydration)
    routes_cpp.push_str(&format!(
        r#"
  _server.on("/api/state", HTTP_GET, [this]() {{
    // TODO: populate this object with your live variables.
    // Example: _server.send(200, "application/json", "{{\"led\":1}}");
    _server.send(200, "application/json", "{{}}");
  }});
"#
    ));

    let ws_code = if uses_serial {
        WEBSOCKET_IMPL.to_string()
    } else {
        String::new()
    };

    let ws_includes = if uses_serial {
        "#ifdef ESP8266\n#include <WebSocketsServer.h>\n#endif\n"
    } else {
        ""
    };

    let ws_member = if uses_serial {
        "  WebSocketsServer _ws{81};\n"
    } else {
        ""
    };

    let ws_setup = if uses_serial {
        "    _ws.begin();\n"
    } else {
        ""
    };

    let ws_tick = if uses_serial {
        "    _ws.loop();\n"
    } else {
        ""
    };

    let header = format!(
        r#"// ── tsuki-webkit auto-generated header ── DO NOT EDIT ──────────────────────
// Generated from: {entrypoint}
// tsuki-webkit v{version}
// ─────────────────────────────────────────────────────────────────────────────
#pragma once
#include <Arduino.h>
#ifdef ESP8266
#  include <ESP8266WiFi.h>
#  include <ESP8266WebServer.h>
   typedef ESP8266WebServer TsukiWifiServer;
#elif defined(ESP32)
#  include <WiFi.h>
#  include <WebServer.h>
   typedef WebServer TsukiWifiServer;
#else
#  error "tsuki-webkit requires an ESP8266 or ESP32 board."
#endif
{ws_includes}
// ── Embedded HTML page (stored in flash / PROGMEM) ────────────────────────────
static const char _WEBKIT_PAGE[] PROGMEM = R"rawstr(
{full_page}
)rawstr";

// ─────────────────────────────────────────────────────────────────────────────
//  TsukiWebApp
//  Usage in main.go (transpiled):
//    const app = TsukiWebApp()
//    app.setup()  // call from setup()
//    app.tick()   // call from loop()
// ─────────────────────────────────────────────────────────────────────────────
class TsukiWebApp {{
  TsukiWifiServer _server;
{ws_member}  bool _started;

public:
  TsukiWebApp() : _server({port}), _started(false) {{}}

  // Call from setup() — must be called AFTER WiFi.begin()/WiFi.connect()
  void setup() {{
    // Serve the main page
    _server.on("/", HTTP_GET, [this]() {{
      _server.send_P(200, "text/html", _WEBKIT_PAGE);
    }});
    {routes_cpp}
    _server.begin();
{ws_setup}    _started = true;
    Serial.print(F("[tsuki-webkit] Server started on port "));
    Serial.println({port});
    Serial.print(F("[tsuki-webkit] IP: "));
    Serial.println(WiFi.localIP());
  }}

  // Call from loop()
  void tick() {{
    if (!_started) return;
    _server.handleClient();
{ws_tick}  }}
{ws_code}}};
"#,
        entrypoint = manifest.app.entrypoint,
        version    = manifest.version,
        ws_includes= ws_includes,
        full_page  = full_page,
        ws_member  = ws_member,
        port       = port,
        routes_cpp = routes_cpp,
        ws_setup   = ws_setup,
        ws_tick    = ws_tick,
        ws_code    = ws_code,
    );

    Ok(CppOutput { header })
}

fn render_route(route: &ApiRoute) -> Result<String> {
    let method = route.method.as_cpp();
    let path   = &route.path;

    // Translate the JS handler body into a minimal C++ block.
    // For now: any Json.stringify({...}) → build an Arduino String and send it.
    let body_cpp = translate_handler_body(&route.body);

    Ok(format!(
        r#"
  _server.on("{path}", {method}, [this]() {{
    {body}
    if (!_client_responded) {{
      _server.send(200, "application/json", _resp);
    }}
  }});
"#,
        path   = path,
        method = method,
        body   = body_cpp,
    ))
}

/// Very minimal JS→C++ handler body translation.
/// Handles: Json.stringify({key: value}) → JSON String building
///          return expr → _resp = expr
fn translate_handler_body(js: &str) -> String {
    let mut cpp = String::from("    String _resp = \"\";\n    bool _client_responded = false;\n");

    // Detect Json.stringify(...)
    if js.contains("Json.stringify") || js.contains("Json .stringify") {
        cpp.push_str("    // TODO: build JSON response\n");
        cpp.push_str("    // Replace with: _resp = \"{\\\"key\\\":\" + String(value) + \"}\";\n");
    }

    // Detect return expr
    if js.contains("return ") {
        cpp.push_str("    // TODO: set _resp to your response string\n");
    }

    // Include original JS as comment for reference
    let commented: String = js.lines().map(|l| format!("    // JS: {}\n", l)).collect();
    cpp.push_str(&commented);

    cpp
}

fn build_html_page(title: &str, body_html: &str, js: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    /* tsuki-webkit default styles */
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      margin: 0; padding: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f0f; color: #e2e2e2;
    }}
    button {{
      background: #1a1a1a; color: #e2e2e2; border: 1px solid #333;
      padding: 8px 16px; border-radius: 6px; cursor: pointer;
      font-size: 14px; transition: background 0.15s;
    }}
    button:hover {{ background: #2a2a2a; }}
    input, select {{
      background: #1a1a1a; color: #e2e2e2; border: 1px solid #333;
      padding: 8px 12px; border-radius: 6px; font-size: 14px; width: 100%;
    }}
    .tsuki-expr {{ font-family: monospace; color: #00e5b0; }}
    .card {{
      background: #1a1a1a; border: 1px solid #2a2a2a;
      border-radius: 10px; padding: 16px; margin-bottom: 12px;
    }}
    h1, h2, h3 {{ color: #ffffff; margin-top: 0; }}
    label {{ font-size: 13px; color: #999; display: block; margin-bottom: 4px; }}
  </style>
</head>
<body>
{body_html}
<script>
{js}
</script>
</body>
</html>"#,
        title     = escape_html(title),
        body_html = body_html,
        js        = js,
    )
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Escape content for a C++ raw string literal delimited by )rawstr"
/// If the content contains )rawstr" we'd break the literal — replace with a
/// safe sequence. In practice this never happens in generated HTML.
fn escape_progmem(s: &str) -> String {
    s.replace(")rawstr\"", ")rawstr_END\"")
}

const WEBSOCKET_IMPL: &str = r#"
  // WebSocket broadcast — call from your handlers to push data to browsers
  void wsBroadcast(const String& msg) {
    _ws.broadcastTXT(msg);
  }
"#;