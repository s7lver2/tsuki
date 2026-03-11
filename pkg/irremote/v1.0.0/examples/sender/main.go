package main

import (
	"arduino"
	"fmt"
	"irremote"
)

const (
	senderPin   = 3
	repeatCount = 0
)

func setup() {
	arduino.Serial.Begin(115200)
	irremote.SenderBegin(senderPin)
	fmt.Println("IR sender ready on pin", senderPin)
}

func loop() {
	// Send NEC command (address 0x00, command 0x45 = "POWER")
	fmt.Println("Sending NEC POWER...")
	irremote.SendNEC(0x00, 0x45, repeatCount)
	arduino.Delay(1000)

	// Send NEC command (address 0x00, command 0x46 = "VOL+")
	fmt.Println("Sending NEC VOL+...")
	irremote.SendNEC(0x00, 0x46, repeatCount)
	arduino.Delay(1000)

	// Send Sony command
	fmt.Println("Sending Sony command...")
	irremote.SendSony(0x010, 0x15, repeatCount)
	arduino.Delay(2000)
}
