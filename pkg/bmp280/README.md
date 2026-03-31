# bmp280

BMP280/BME280 barometric pressure and temperature sensor driver for tsuki.

Wraps the **Adafruit BMP280 Library** and exposes a clean Go/Python API for reading temperature, pressure, and altitude from Bosch BMP280 and BME280 sensors.

---

## Installation

```
tsuki pkg install bmp280
```

---

## Usage

```go
import "bmp280"

func setup() {
    sensor := bmp280.New()
    if !sensor.Begin() {
        println("BMP280 not found")
        return
    }
}

func loop() {
    temp     := sensor.ReadTemperature()   // °C
    pressure := sensor.ReadPressure()      // Pa
    altitude := sensor.ReadAltitudeStd()   // m (sea level reference)

    println(temp, pressure, altitude)
    delay(1000)
}
```

---

## API Reference

### Constructor

| Go | Python | Description |
|---|---|---|
| `bmp280.New()` | `bmp280.new()` | Creates a new BMP280 instance |

### Initialization

| Go | Python | Description |
|---|---|---|
| `Begin()` | `begin()` | Initialize with default I2C address (0x77) |
| `BeginAddr(addr)` | `begin_addr(addr)` | Initialize with custom I2C address |

### Readings

| Go | Python | Description |
|---|---|---|
| `ReadTemperature()` | `read_temperature()` | Returns temperature in °C |
| `ReadPressure()` | `read_pressure()` | Returns pressure in Pa |
| `ReadAltitude(seaLevel)` | `read_altitude(sea_level)` | Altitude with custom sea-level pressure |
| `ReadAltitudeStd()` | `read_altitude_std()` | Altitude with standard pressure (1013.25 hPa) |

### Sampling Configuration

| Go | Python | Description |
|---|---|---|
| `SetSampling(mode, tempOS, pressOS, filter, standby)` | `set_sampling(...)` | Full sampling config |
| `ForcedSample()` | `forced_sample()` | Take a single forced measurement |

---

## Constants

### Modes
- `MODE_NORMAL` — Continuous sampling
- `MODE_FORCED` — One-shot measurement
- `MODE_SLEEP`  — Low power sleep

### Oversampling
`SAMPLING_X1`, `SAMPLING_X2`, `SAMPLING_X4`, `SAMPLING_X8`, `SAMPLING_X16`

### Filter
`FILTER_OFF`, `FILTER_X2`, `FILTER_X4`, `FILTER_X16`

### Standby time
`STANDBY_MS_1`, `STANDBY_MS_63`, `STANDBY_MS_500`, `STANDBY_MS_1000`

---

## Hardware

- **Interface:** I2C (default address `0x77`, alternate `0x76`)
- **Supply voltage:** 1.71 – 3.6 V
- **Compatible:** BMP280, BME280 (temperature + pressure only)

> **Note:** The BME280 also has a humidity sensor. Humidity readings are not currently exposed — use the `bmp280` package only for temperature and pressure on BME280.

---

## Examples

See `examples/basic` and `examples/altitude_logger` in this package.
