package main

import (
	"arduino"
	"tsuki-webkit"
)

// tsuki-webkit wires up an HTTP server on port 80.
// ApiInit() creates routes you define with app.Handle(); then call setup/tick.
//
// The compiled app.jsx (dist/webkit.cpp) is injected by tsuki-flash automatically
// before compilation — you do not need to include it manually.

const app = tsuki - webkit.ApiInit()

const ledPin    = 2   // GPIO2 / D4 on NodeMCU — onboard LED (active LOW)
const dhtPin    = 4   // GPIO4 / D2 — DHT22 data pin
const wifiSSID  = "YourNetwork"
const wifiPass  = "YourPassword"

func setup() {
	// Connect to WiFi (handled by tsuki-webkit.ApiInit internally when
	// WIFI_SSID / WIFI_PASS are set in tsuki-webkit.conf.json or via env)
	app.WiFi(wifiSSID, wifiPass)

	// GPIO setup
	arduino.PinMode(ledPin, arduino.OUTPUT)
	arduino.DigitalWrite(ledPin, arduino.HIGH) // LED off (active LOW)

	// ── Define API routes ────────────────────────────────────────────────────

	// GET /api/status — basic health check
	app.Handle("GET", "/api/status", func(req tsuki-webkit.Request) tsuki-webkit.Response {
		return tsuki-webkit.JSON(map[string]interface{}{
			"status":  "ok",
			"heap":    arduino.FreeHeap(),
			"uptime":  arduino.Millis(),
		})
	})

	// POST /api/led — control onboard LED
	// Body: { "state": 1 } or { "state": 0 }
	app.Handle("POST", "/api/led", func(req tsuki-webkit.Request) tsuki-webkit.Response {
		state := req.Json.GetInt("state")
		if state == 1 {
			arduino.DigitalWrite(ledPin, arduino.LOW) // active LOW
		} else {
			arduino.DigitalWrite(ledPin, arduino.HIGH)
		}
		return tsuki-webkit.JSON(map[string]interface{}{"ok": true, "state": state})
	})

	// GET /api/sensors — mock sensor readings (replace with real DHT lib)
	app.Handle("GET", "/api/sensors", func(req tsuki-webkit.Request) tsuki-webkit.Response {
		return tsuki-webkit.JSON(map[string]interface{}{
			"temperature": 22.5,
			"humidity":    58.0,
		})
	})

	app.setup()

	arduino.Serial.Begin(115200)
	arduino.Serial.Println("tsuki-webkit dashboard ready")
	arduino.Serial.Println("Open http://" + app.LocalIP() + " in your browser")
}

func loop() {
	app.tick()
}
