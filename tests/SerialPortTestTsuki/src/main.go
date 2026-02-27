package main

import "arduino"

func setup() {
	arduino.SerialBegin(9600)
}

func loop() {
	arduino.SerialPrintln("Hello from tsuki!")
	arduino.Delay(1000)
}
