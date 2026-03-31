# stepper

Stepper motor driver with acceleration and speed control for tsuki, powered by **AccelStepper**.

Supports 2-wire, 4-wire, and driver-board (STEP/DIR) configurations with smooth acceleration curves, non-blocking movement, and multi-motor coordination.

---

## Installation

```
tsuki pkg install stepper
```

---

## Usage

```go
import "stepper"

var motor stepper.Motor

func setup() {
    // 4-wire stepper on pins 8, 9, 10, 11
    motor = stepper.New4Wire(8, 9, 10, 11)
    motor.SetMaxSpeed(200)       // steps/sec
    motor.SetAcceleration(100)   // steps/sec²
    motor.MoveTo(1000)           // move to absolute position
}

func loop() {
    motor.Run()   // call every loop iteration — non-blocking
}
```

### Driver board (STEP/DIR)

```go
motor = stepper.NewDriver(stepPin, dirPin)
motor.SetMaxSpeed(500)
motor.SetAcceleration(200)
motor.Move(400)   // relative move
```

---

## API Reference

### Constructors

| Go | Python | Description |
|---|---|---|
| `NewDriver(step, dir)` | `new_driver(step, dir)` | STEP/DIR interface (A4988, DRV8825, etc.) |
| `New2Wire(pin1, pin2)` | `new_2wire(p1, p2)` | 2-wire (half-step) |
| `New4Wire(p1,p2,p3,p4)` | `new_4wire(...)` | 4-wire full-step |

### Configuration

| Go | Python | Description |
|---|---|---|
| `SetMaxSpeed(sps)` | `set_max_speed(sps)` | Maximum speed in steps/sec |
| `SetAcceleration(a)` | `set_acceleration(a)` | Acceleration in steps/sec² |
| `SetSpeed(sps)` | `set_speed(sps)` | Constant speed (no accel) |

### Movement

| Go | Python | Description |
|---|---|---|
| `MoveTo(pos)` | `move_to(pos)` | Move to absolute position |
| `Move(steps)` | `move(steps)` | Move relative steps |
| `Run()` | `run()` | Advance motor (call in loop) |
| `RunSpeed()` | `run_speed()` | Run at constant speed |
| `RunToPosition()` | `run_to_position()` | Blocking run to target |
| `Stop()` | `stop()` | Decelerate to stop |

### Position

| Go | Python | Description |
|---|---|---|
| `CurrentPosition()` | `current_position()` | Current position in steps |
| `DistanceToGo()` | `distance_to_go()` | Remaining steps |
| `SetCurrentPosition(p)` | `set_current_position(p)` | Override current position |

---

## Hardware

- Compatible with any 2-wire, 4-wire bipolar/unipolar stepper
- Driver boards: A4988, DRV8825, TMC2208, TB6600, and similar STEP/DIR drivers

> **Important:** Always call `motor.Run()` or `motor.RunSpeed()` inside `loop()`. These functions are non-blocking and must be called repeatedly to advance the motor.

---

## Examples

See `examples/basic` and `examples/speed_control` in this package.
