package main

import (
	"arduino"
	"bmp280"
	"fmt"
)

const seaLevelPressure = 1013.25

var (
	sensor    = bmp280.New()
	baseAlt   float32
	sampleIdx int
)

func setup() {
	arduino.Serial.Begin(115200)

	sensor.SetSampling(
		bmp280.MODE_NORMAL,
		bmp280.SAMPLING_X2,
		bmp280.SAMPLING_X16,
		bmp280.FILTER_X4,
		bmp280.STANDBY_MS_63,
	)

	if !sensor.Begin() {
		fmt.Println("BMP280 not found!")
		for {
			arduino.Delay(1000)
		}
	}

	// Calibrate base altitude (average 10 readings)
	var sum float32
	for i := 0; i < 10; i++ {
		sum += sensor.ReadAltitude(seaLevelPressure)
		arduino.Delay(100)
	}
	baseAlt = sum / 10.0
	fmt.Println("Base altitude:", baseAlt, "m — logging started")
}

func loop() {
	alt    := sensor.ReadAltitude(seaLevelPressure)
	relAlt := alt - baseAlt
	temp   := sensor.ReadTemperature()

	sampleIdx++
	fmt.Println(sampleIdx, temp, alt, relAlt)
	arduino.Delay(500)
}
