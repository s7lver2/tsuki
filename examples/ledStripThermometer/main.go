package main

import (
	"arduino"
	"dht"
	"ws2812"
)

const (
	NUM_PIXELS = 16
	DATA_PIN   = 6
	DHT_PIN    = 2
	DHT_TYPE   = dht.DHT22
)

var strip = ws2812.New(NUM_PIXELS, DATA_PIN, ws2812.NEO_GRB+ws2812.NEO_KHZ800)
var sensor = dht.New(DHT_PIN, DHT_TYPE)

func setup() {
	arduino.SerialBegin(9600)
	strip.Begin()
	strip.SetBrightness(80)
	strip.Show()
	sensor.Begin()
}

func loop() {
	temp := sensor.ReadTemperature()
	hum  := sensor.ReadHumidity()

	arduino.SerialPrint("Temp: ")
	arduino.SerialPrint(temp)
	arduino.SerialPrint("°C  Humidity: ")
	arduino.SerialPrint(hum)
	arduino.SerialPrintln("%")

	// Map temperature (0-40°C) to a colour:
	//   cold = blue  (0,0,255)
	//   hot  = red   (255,0,0)
	r := arduino.Map(temp, 0, 40, 0, 255)
	b := arduino.Map(temp, 0, 40, 255, 0)

	for i := 0; i < NUM_PIXELS; i++ {
		strip.SetPixelColor(i, strip.Color(r, 0, b))
	}
	strip.Show()

	arduino.Delay(2000)
}