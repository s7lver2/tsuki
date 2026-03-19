// tsuki-webkit — injector.rs
// Produces the C++ fragment that embeds the HTML page and wires up WebServer routes.

use crate::config::WebkitConfig;

/// Convert a raw HTML string into a C++ PROGMEM const char array.
fn to_progmem(html: &str) -> String {
    // Escape backslashes, quotes, and newlines for a C string literal
    let escaped = html
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n\"\n  \"")
        .replace('\r', "");

    format!("const char INDEX_HTML[] PROGMEM = \n  \"{escaped}\";")
}

pub fn inject(html: &str, board: &str, cfg: &WebkitConfig) -> String {
    let app_name = cfg.name.as_deref().unwrap_or("TsukiApp");
    let is_esp8266 = board == "esp8266";

    let server_include = if is_esp8266 {
        "#include <ESP8266WebServer.h>"
    } else {
        "#include <WebServer.h>"
    };

    let server_type = if is_esp8266 { "ESP8266WebServer" } else { "WebServer" };

    let progmem = to_progmem(html);

    format!(
        r#"// ── tsuki-webkit generated — do not edit ─────────────────────────────────────
// App: {app_name}
{server_include}
#include <pgmspace.h>

{progmem}

{server_type} __webkit_server(80);

// Serial ring-buffer for /serial endpoint
#define WEBKIT_SERIAL_BUF 512
static char __serial_buf[WEBKIT_SERIAL_BUF];
static int  __serial_head = 0;

void webkit_serial_push(const char* msg) {{
  strncat(__serial_buf, msg, WEBKIT_SERIAL_BUF - strlen(__serial_buf) - 1);
}}

void webkit_setup_routes() {{
  __webkit_server.on("/", HTTP_GET, []() {{
    __webkit_server.send_P(200, "text/html", INDEX_HTML);
  }});

  __webkit_server.on("/serial", HTTP_GET, []() {{
    char buf[WEBKIT_SERIAL_BUF + 32];
    snprintf(buf, sizeof(buf), "{{\"data\":\"%s\"}}", __serial_buf);
    memset(__serial_buf, 0, sizeof(__serial_buf));
    __webkit_server.send(200, "application/json", buf);
  }});

  __webkit_server.on("/serial", HTTP_POST, []() {{
    // route for Serial.write from the web UI
    String body = __webkit_server.arg("plain");
    Serial.println(body);
    __webkit_server.send(200, "application/json", "{{\"ok\":true}}");
  }});

  __webkit_server.onNotFound([]() {{
    __webkit_server.send(404, "text/plain", "Not found");
  }});

  __webkit_server.begin();
}}

void webkit_tick() {{
  __webkit_server.handleClient();
}}
"#,
        app_name   = app_name,
        server_include = server_include,
        server_type    = server_type,
        progmem        = progmem,
    )
}
