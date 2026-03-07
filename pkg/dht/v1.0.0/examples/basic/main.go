package main

import (
	"arduino"
	"dht"
	"fmt"
)

const sensorPin = 2

var sensor = dht.New(sensorPin, dht.DHT22)

func setup() {
	arduino.Serial.Begin(9600)
	sensor.Begin()
	fmt.Println("DHT22 ready")
}

func loop() {
	h := sensor.ReadHumidity()
	t := sensor.ReadTemperature()

	if dht.IsNan(h) || dht.IsNan(t) {
		fmt.Println("Sensor read failed — check wiring!")
	} else {
		fmt.Println("Temp:", t, "C   Humidity:", h, "%")
	}
	arduino.Delay(2000)
}
