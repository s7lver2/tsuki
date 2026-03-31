# ws2812

WS2812 / NeoPixel RGB LED driver for tsuki, backed by **Adafruit NeoPixel**.

Control individually-addressable RGB and RGBW LED strips, rings, matrices, and individual LEDs with a single data wire.

---

## Installation

```
tsuki pkg install ws2812
```

---

## Usage

```go
import "ws2812"

const NUM_LEDS = 16
const PIN      = 6

var strip ws2812.Strip

func setup() {
    strip = ws2812.New(NUM_LEDS, PIN, ws2812.GRB + ws2812.KHZ800)
    strip.Begin()
    strip.SetBrightness(80)   // 0–255
}

func loop() {
    // Solid red
    strip.Fill(strip.Color(255, 0, 0))
    strip.Show()
    delay(500)

    // Rainbow
    for i := 0; i < NUM_LEDS; i++ {
        strip.SetPixelColor(i, strip.Wheel(i * 256 / NUM_LEDS))
    }
    strip.Show()
    delay(500)
}
```

---

## API Reference

### Constructor

| Go | Python | Description |
|---|---|---|
| `ws2812.New(n, pin, flags)` | `ws2812.new(n, pin, flags)` | Create strip of n LEDs on pin |

### Initialization

| Go | Python | Description |
|---|---|---|
| `Begin()` | `begin()` | Initialize the strip |
| `SetBrightness(b)` | `set_brightness(b)` | Global brightness 0–255 |

### Color control

| Go | Python | Description |
|---|---|---|
| `SetPixelColor(i, color)` | `set_pixel_color(i, c)` | Set LED i to a 32-bit color |
| `Fill(color)` | `fill(color)` | Fill all LEDs with one color |
| `Clear()` | `clear()` | Turn off all LEDs |
| `Show()` | `show()` | Push data to the strip |

### Color helpers

| Go | Python | Description |
|---|---|---|
| `Color(r, g, b)` | `color(r, g, b)` | Pack RGB into 32-bit color |
| `ColorRGBW(r, g, b, w)` | `color_rgbw(r, g, b, w)` | Pack RGBW into 32-bit color |
| `Wheel(pos)` | `wheel(pos)` | Rainbow color from 0–255 position |
| `GetPixelColor(i)` | `get_pixel_color(i)` | Read back packed color of LED i |

### Info

| Go | Python | Description |
|---|---|---|
| `NumPixels()` | `num_pixels()` | Total LED count |
| `GetBrightness()` | `get_brightness()` | Current brightness value |

---

## Flags

### Byte order
`RGB` · `GRB` (most WS2812) · `BRG` · `RGBW` · `GRBW`

### Speed
`KHZ800` (most strips) · `KHZ400` (older v1 strips)

Combine with `+`: `ws2812.GRB + ws2812.KHZ800`

---

## Hardware

- **Protocol:** Single-wire, 800 kHz NZR
- **Supply:** 5 V (each LED draws up to 60 mA at full white)
- **Data resistor:** 300–500 Ω series resistor on DATA line recommended
- **Decoupling:** 1000 µF capacitor across power rails for large strips

> **Power tip:** At full brightness (255), 60 LEDs can draw ~3.6 A. Use an external 5 V supply and connect GND to the Arduino.

---

## Examples

See `examples/blink`, `examples/rainbow`, and `examples/theater_chase` in this package.
