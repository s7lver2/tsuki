package main

import (
	"arduino"
	"ws2812"
)

const numPixels = 8
const pin       = 6

var strip = ws2812.New(numPixels, pin, ws2812.NEO_GRB+ws2812.NEO_KHZ800)

func setup() {
	strip.Begin()
	strip.SetBrightness(50)
	strip.Show()
}

var hue uint16 = 0

func loop() {
	strip.Rainbow(hue)
	strip.Show()
	hue += 256
	arduino.Delay(10)
}
