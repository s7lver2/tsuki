package main

import (
	"arduino"
	"fmt"
	"u8g2"
)

var display = u8g2.NewSSD1306_128x64_I2C(0x3C)

var count = 0

func setup() {
	display.Begin()
	display.SetFont(u8g2.Font_ncenB08_tr)
	arduino.Serial.Begin(9600)
}

func loop() {
	ms      := arduino.Millis()
	seconds := ms / 1000

	display.ClearBuffer()
	display.DrawStr(0, 12, "tsuki counter")
	display.DrawStr(0, 28, fmt.Sprintf("count: %d", count))
	display.DrawStr(0, 44, fmt.Sprintf("up:    %ds", seconds))
	display.SendBuffer()

	fmt.Println("count:", count, "uptime:", seconds, "s")
	count++
	arduino.Delay(500)
}
