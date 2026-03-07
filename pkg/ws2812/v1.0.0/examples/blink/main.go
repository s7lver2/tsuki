package main

import (
	"arduino"
	"ws2812"
)

const pin = 6

var pixel = ws2812.New(1, pin, ws2812.NEO_GRB+ws2812.NEO_KHZ800)

func setup() {
	pixel.Begin()
	pixel.SetBrightness(80)
}

func loop() {
	pixel.SetPixelColor(0, ws2812.Color(255, 0, 0)) // red
	pixel.Show()
	arduino.Delay(500)

	pixel.SetPixelColor(0, ws2812.Color(0, 0, 0)) // off
	pixel.Show()
	arduino.Delay(500)
}
