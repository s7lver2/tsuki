# dht

DHT11 and DHT22 temperature and humidity sensor driver for tsuki.

Supports both the **DHT11** (low-cost, lower precision) and **DHT22** (higher accuracy) sensors via a single unified API.

---

## Installation

```
tsuki pkg install dht
```

---

## Usage

```go
import "dht"

var sensor dht.DHT

func setup() {
    sensor = dht.New(2, dht.DHT22)  // pin 2, DHT22 type
    sensor.Begin()
}

func loop() {
    humidity    := sensor.ReadHumidity()
    temperature := sensor.ReadTemperature()

    println("Humidity:", humidity, "%")
    println("Temperature:", temperature, "°C")
    delay(2000)  // DHT sensors need at least 2s between readings
}
```

---

## API Reference

### Constructor

| Go | Python | Description |
|---|---|---|
| `dht.New(pin, type)` | `dht.new(pin, type)` | Create sensor on given pin |

### Initialization

| Go | Python | Description |
|---|---|---|
| `Begin()` | `begin()` | Initialize the sensor |

### Readings

| Go | Python | Description |
|---|---|---|
| `ReadTemperature()` | `read_temperature()` | Temperature in °C |
| `ReadTemperatureF()` | `read_temperature_f()` | Temperature in °F |
| `ReadHumidity()` | `read_humidity()` | Relative humidity in % |
| `ComputeHeatIndex(t, h)` | `compute_heat_index(t, h)` | Heat index in °C |

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `DHT11` | 11 | DHT11 sensor type |
| `DHT22` | 22 | DHT22 / AM2302 sensor type |

---

## Hardware

- **Interface:** Single-wire digital (1-Wire compatible)
- **DHT11:** 20–90% RH (±5%), 0–50°C (±2°C)
- **DHT22:** 0–100% RH (±2–5%), -40–80°C (±0.5°C)
- **Pull-up:** 10 kΩ resistor between DATA and VCC recommended

> **Timing:** The DHT protocol requires at least **2 seconds** between readings. Reading more frequently will return stale or invalid data.

---

## Examples

See `examples/basic` in this package.
