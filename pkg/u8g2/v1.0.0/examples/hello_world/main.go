package main

import (
	"arduino"
	"u8g2"
)

var display = u8g2.NewSSD1306_128x64_I2C(0x3C)

func setup() {
	display.Begin()
	display.SetFont(u8g2.Font_ncenB08_tr)
}

func loop() {
	display.ClearBuffer()
	display.DrawStr(0, 12, "Hello, tsuki!")
	display.DrawStr(0, 28, "Arduino in Go")
	display.SendBuffer()
	arduino.Delay(1000)
}
