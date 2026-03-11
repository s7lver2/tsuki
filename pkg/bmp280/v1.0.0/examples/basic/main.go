package main

import (
	"arduino"
	"bmp280"
	"fmt"
)

var sensor = bmp280.New()

func setup() {
	arduino.Serial.Begin(9600)
	if !sensor.Begin() {
		fmt.Println("BMP280 not found — check wiring!")
		for {
			arduino.Delay(1000)
		}
	}
	fmt.Println("BMP280 ready")
}

func loop() {
	temp := sensor.ReadTemperature()
	pres := sensor.ReadPressure()
	alt  := sensor.ReadAltitudeStd()

	fmt.Println("Temp:", temp, "C")
	fmt.Println("Pressure:", pres/100.0, "hPa")
	fmt.Println("Altitude:", alt, "m")
	fmt.Println("---")
	arduino.Delay(2000)
}
