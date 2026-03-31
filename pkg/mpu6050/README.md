# mpu6050

MPU-6050 6-axis accelerometer and gyroscope driver for tsuki, backed by the **Adafruit MPU6050** library.

Provides access to 3-axis acceleration, 3-axis gyroscope data, and an on-chip temperature sensor over I2C.

---

## Installation

```
tsuki pkg install mpu6050
```

---

## Usage

```go
import "mpu6050"

var imu mpu6050.MPU6050

func setup() {
    imu = mpu6050.New()
    if !imu.Begin() {
        println("MPU6050 not found")
        return
    }
    imu.SetAccelRange(mpu6050.ACCEL_RANGE_8G)
    imu.SetGyroRange(mpu6050.GYRO_RANGE_500DEG)
    imu.SetFilterBandwidth(mpu6050.BAND_21_HZ)
}

func loop() {
    accel := imu.GetAcceleration()   // returns {X, Y, Z} in m/s²
    gyro  := imu.GetRotation()       // returns {X, Y, Z} in rad/s
    temp  := imu.GetTemperature()    // °C

    println("Accel X:", accel.X, "Y:", accel.Y, "Z:", accel.Z)
    println("Gyro  X:", gyro.X,  "Y:", gyro.Y,  "Z:", gyro.Z)
    delay(100)
}
```

---

## API Reference

### Constructor

| Go | Python | Description |
|---|---|---|
| `mpu6050.New()` | `mpu6050.new()` | Create a new MPU6050 instance |

### Initialization

| Go | Python | Description |
|---|---|---|
| `Begin()` | `begin()` | Initialize at default address (0x68) |
| `BeginAddr(addr)` | `begin_addr(addr)` | Initialize at custom I2C address |

### Reading Data

| Go | Python | Description |
|---|---|---|
| `GetAcceleration()` | `get_acceleration()` | 3-axis acceleration (m/s²) |
| `GetRotation()` | `get_rotation()` | 3-axis gyroscope (rad/s) |
| `GetTemperature()` | `get_temperature()` | On-chip temperature (°C) |

### Configuration

| Go | Python | Description |
|---|---|---|
| `SetAccelRange(range)` | `set_accel_range(range)` | Set accelerometer full-scale range |
| `SetGyroRange(range)` | `set_gyro_range(range)` | Set gyroscope full-scale range |
| `SetFilterBandwidth(bw)` | `set_filter_bandwidth(bw)` | Set DLPF cutoff frequency |
| `SetCycleRate(rate)` | `set_cycle_rate(rate)` | Set wake cycle rate (low-power mode) |

---

## Constants

### Accelerometer range
`ACCEL_RANGE_2G` · `ACCEL_RANGE_4G` · `ACCEL_RANGE_8G` · `ACCEL_RANGE_16G`

### Gyroscope range
`GYRO_RANGE_250DEG` · `GYRO_RANGE_500DEG` · `GYRO_RANGE_1000DEG` · `GYRO_RANGE_2000DEG`

### Filter bandwidth
`BAND_260_HZ` · `BAND_184_HZ` · `BAND_94_HZ` · `BAND_44_HZ` · `BAND_21_HZ` · `BAND_10_HZ` · `BAND_5_HZ`

---

## Hardware

- **Interface:** I2C, address `0x68` (AD0 low) or `0x69` (AD0 high)
- **Supply:** 2.375 – 3.46 V (use level shifter with 5 V boards)
- **Axes:** 3-axis accel + 3-axis gyro + 1-axis temperature

---

## Examples

See `examples/basic` and `examples/tilt_servo` in this package.
