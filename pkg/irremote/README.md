# irremote

IR remote send and receive driver for tsuki, backed by **IRremote v4**.

Supports decoding signals from most consumer IR remotes (NEC, Sony, RC5, RC6, Samsung, and more) and sending IR commands via an IR LED.

---

## Installation

```
tsuki pkg install irremote
```

---

## Usage

### Receive

```go
import "irremote"

var recv irremote.Receiver

func setup() {
    recv = irremote.NewReceiver(11)  // IR receiver on pin 11
    recv.Begin()
}

func loop() {
    if recv.Available() {
        code := recv.Read()
        println("Received:", code.Value, "Protocol:", code.Protocol)
        recv.Resume()
    }
}
```

### Send

```go
import "irremote"

var sender irremote.Sender

func setup() {
    sender = irremote.NewSender()
    sender.Begin()
}

func loop() {
    sender.SendNEC(0x1234, 32)  // address, bits
    delay(1000)
}
```

---

## API Reference

### Receiver

| Go | Python | Description |
|---|---|---|
| `NewReceiver(pin)` | `new_receiver(pin)` | Create receiver on pin |
| `Begin()` | `begin()` | Initialize receiver |
| `Available()` | `available()` | Returns true if a signal was received |
| `Read()` | `read()` | Read decoded signal (returns IRData struct) |
| `Resume()` | `resume()` | Re-enable reception after reading |

### Sender

| Go | Python | Description |
|---|---|---|
| `NewSender()` | `new_sender()` | Create sender instance |
| `Begin()` | `begin()` | Initialize sender |
| `SendNEC(addr, bits)` | `send_nec(addr, bits)` | Send NEC protocol signal |
| `SendSony(data, bits)` | `send_sony(data, bits)` | Send Sony SIRC protocol |
| `SendRC5(addr, cmd)` | `send_rc5(addr, cmd)` | Send RC5 protocol |
| `SendRaw(buf, hz)` | `send_raw(buf, hz)` | Send raw timing buffer |

---

## Supported Protocols

NEC · NEC2 · Sony (SIRC) · RC5 · RC6 · Samsung · LG · Panasonic · JVC · Kaseikyo · DENON

---

## Hardware

- **IR receiver:** TSOP38238, VS1838B, or equivalent (38 kHz carrier)
- **IR LED:** Any IR LED with a current-limiting resistor (~100 Ω)
- **Carrier frequency:** 38 kHz (default), configurable for other protocols

---

## Examples

See `examples/receiver` and `examples/sender` in this package.
