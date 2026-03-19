import { Api, Json, Serial } from 'tsuki-webkit'

// ── Tsuki-Webkit Dashboard Example ───────────────────────────────────────────
// This is a real-time control panel for an ESP8266/ESP32.
// The board exposes REST endpoints; this UI polls and controls them over WiFi.
//
// Build: tsuki webkit build --board esp8266
// Flash: tsuki build && tsuki upload

export default function App() {
  return (
    <div>
      <h1>ESP Dashboard</h1>

      {/* ── Status card ──────────────────────────────────────────────────── */}
      <div className="wk-card">
        <span className="wk-label">System status</span>
        <div className="wk-row">
          <span id="status-text" className="wk-badge">loading…</span>
          <button className="wk-btn"
            onClick={() => Api.get('/api/status', function(d) {
              document.getElementById('status-text').textContent = d.status || 'ok'
              Serial.log('status: ' + Json.stringify(d))
            })}>
            Refresh
          </button>
        </div>
      </div>

      {/* ── LED control ──────────────────────────────────────────────────── */}
      <div className="wk-card">
        <span className="wk-label">Onboard LED (pin 2)</span>
        <div className="wk-row">
          <button className="wk-btn"
            onClick={() => Api.post('/api/led', { state: 1 }, function(r) {
              Serial.log('LED on → ' + Json.stringify(r))
            })}>
            ON
          </button>
          <button className="wk-btn" style="background:#64748b"
            onClick={() => Api.post('/api/led', { state: 0 }, function(r) {
              Serial.log('LED off → ' + Json.stringify(r))
            })}>
            OFF
          </button>
        </div>
      </div>

      {/* ── Sensor readings ──────────────────────────────────────────────── */}
      <div className="wk-card">
        <span className="wk-label">Sensor readings (auto-poll every 3 s)</span>
        <div className="wk-col">
          <div className="wk-row">
            <span className="wk-label">Temperature</span>
            <span id="sensor-temp" className="wk-badge">—</span>
          </div>
          <div className="wk-row">
            <span className="wk-label">Humidity</span>
            <span id="sensor-hum" className="wk-badge">—</span>
          </div>
        </div>
      </div>

      {/* ── Serial console ───────────────────────────────────────────────── */}
      <div className="wk-card">
        <span className="wk-label">Serial console</span>
        <div id="__serial_log" className="wk-serial"></div>
        <div className="wk-row" style="margin-top:8px">
          <input id="serial-in" className="wk-input" placeholder="Send command…" />
          <button className="wk-btn"
            onClick={() => {
              var v = document.getElementById('serial-in').value
              Serial.write(v)
              document.getElementById('serial-in').value = ''
            }}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Auto-poll sensor readings on page load ───────────────────────────────────
Api.poll('/api/sensors', function(d) {
  var t = document.getElementById('sensor-temp')
  var h = document.getElementById('sensor-hum')
  if (t) t.textContent = (d.temperature !== undefined ? d.temperature + ' °C' : '—')
  if (h) h.textContent = (d.humidity    !== undefined ? d.humidity    + ' %'  : '—')
}, 3000)
