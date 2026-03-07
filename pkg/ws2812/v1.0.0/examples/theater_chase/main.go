package main

import (
	"arduino"
	"ws2812"
)

const numPixels = 12
const pin       = 6

var strip = ws2812.New(numPixels, pin, ws2812.NEO_GRB+ws2812.NEO_KHZ800)

func setup() {
	strip.Begin()
	strip.SetBrightness(60)
}

func loop() {
	theaterChase(ws2812.Color(127, 127, 127), 50) // white
	theaterChase(ws2812.Color(127, 0, 0), 50)     // red
	theaterChase(ws2812.Color(0, 0, 127), 50)     // blue
}

func theaterChase(color uint32, wait int) {
	for n := 0; n < 10; n++ {
		for q := 0; q < 3; q++ {
			strip.Clear()
			for i := q; i < numPixels; i += 3 {
				strip.SetPixelColor(i, color)
			}
			strip.Show()
			arduino.Delay(wait)
		}
	}
}
