package main

import (
	"arduino"
	"fmt"
	"irremote"
)

const receiverPin = 2

func setup() {
	arduino.Serial.Begin(115200)
	irremote.ReceiverBegin(receiverPin)
	fmt.Println("IR receiver ready on pin", receiverPin)
}

func loop() {
	if irremote.DataAvailable() {
		address  := irremote.GetAddress()
		command  := irremote.GetCommand()
		protocol := irremote.GetProtocol()

		fmt.Println("Protocol:", protocol, " Address:", address, " Command:", command)

		// Example: react to specific NEC commands
		if protocol == irremote.PROTOCOL_NEC {
			switch command {
			case 0x45:
				fmt.Println("→ POWER button")
			case 0x46:
				fmt.Println("→ VOL+ button")
			case 0x47:
				fmt.Println("→ FUNC/STOP button")
			}
		}

		irremote.Resume()
	}
}
