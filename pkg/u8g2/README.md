# u8g2

Monochrome display library for tsuki, backed by **U8g2**.

Supports a wide range of OLED and LCD displays (SSD1306, SH1106, ST7565, PCD8544, and 80+ more controllers) over I2C or SPI.

---

## Installation

```
tsuki pkg install u8g2
```

---

## Usage

```go
import "u8g2"

var display u8g2.Display

func setup() {
    // SSD1306 128×64 OLED on I2C
    display = u8g2.NewSSD1306_128x64_I2C(u8g2.R0)
    display.Begin()
}

func loop() {
    display.ClearBuffer()

    display.SetFont(u8g2.FONT_6X10)
    display.DrawStr(0, 14, "Hello tsuki!")

    display.DrawFrame(0, 20, 128, 30)
    display.DrawBox(10, 24, 40, 22)

    display.SendBuffer()
    delay(1000)
}
```

---

## API Reference

### Constructors

Common display targets (many more available — see U8g2 docs):

| Constructor | Description |
|---|---|
| `NewSSD1306_128x64_I2C(rot)` | 128×64 OLED via I2C |
| `NewSSD1306_128x32_I2C(rot)` | 128×32 OLED via I2C |
| `NewSH1106_128x64_I2C(rot)` | SH1106 OLED via I2C |
| `NewST7565_SPI(cs, dc, rot)` | ST7565 LCD via SPI |
| `NewPCD8544_SPI(cs, dc, rot)` | Nokia 5110 LCD |

### Buffer management

| Go | Python | Description |
|---|---|---|
| `Begin()` | `begin()` | Initialize display |
| `ClearBuffer()` | `clear_buffer()` | Clear the internal buffer |
| `SendBuffer()` | `send_buffer()` | Send buffer to display |
| `ClearDisplay()` | `clear_display()` | Clear display immediately |

### Drawing primitives

| Go | Python | Description |
|---|---|---|
| `DrawPixel(x, y)` | `draw_pixel(x, y)` | Draw single pixel |
| `DrawLine(x0,y0,x1,y1)` | `draw_line(...)` | Draw a line |
| `DrawFrame(x,y,w,h)` | `draw_frame(...)` | Draw rectangle outline |
| `DrawBox(x,y,w,h)` | `draw_box(...)` | Draw filled rectangle |
| `DrawCircle(cx,cy,r)` | `draw_circle(...)` | Draw circle outline |
| `DrawDisc(cx,cy,r)` | `draw_disc(...)` | Draw filled circle |
| `DrawTriangle(x0,y0,x1,y1,x2,y2)` | `draw_triangle(...)` | Draw filled triangle |

### Text

| Go | Python | Description |
|---|---|---|
| `SetFont(font)` | `set_font(font)` | Set active font |
| `DrawStr(x,y,str)` | `draw_str(x,y,s)` | Draw string at position |
| `DrawGlyph(x,y,enc)` | `draw_glyph(...)` | Draw single character |
| `GetStrWidth(str)` | `get_str_width(s)` | Measure string width in pixels |

### Rotation constants

`R0` · `R1` (90°) · `R2` (180°) · `R3` (270°) · `MIRROR`

---

## Fonts

Common built-in fonts:

`FONT_4X6` · `FONT_5X7` · `FONT_5X8` · `FONT_6X10` · `FONT_6X12` · `FONT_7X13` · `FONT_8X13` · `FONT_10X20` · `FONT_NCENR08` · `FONT_HELVB08`

---

## Hardware

- **I2C:** Default address `0x3C` (some modules use `0x3D`)
- **SPI:** Requires CS, DC, and optionally RESET pins
- **Supply:** 3.3 V or 5 V (module-dependent)

---

## Examples

See `examples/hello_world` and `examples/counter` in this package.
