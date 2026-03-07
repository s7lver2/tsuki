package main

import (
	"arduino"
	"dht"
	"fmt"
)

const pin1 = 2
const pin2 = 3

var s1 = dht.New(pin1, dht.DHT22)
var s2 = dht.New(pin2, dht.DHT11)

func setup() {
	arduino.Serial.Begin(9600)
	s1.Begin()
	s2.Begin()
	fmt.Println("Dual DHT ready")
}

func loop() {
	h1 := s1.ReadHumidity()
	t1 := s1.ReadTemperature()
	hi  := s1.ComputeHeatIndex(t1, h1)

	h2 := s2.ReadHumidity()
	t2 := s2.ReadTemperature()

	fmt.Println("--- Sensor 1 (DHT22, pin 2) ---")
	if dht.IsNan(t1) || dht.IsNan(h1) {
		fmt.Println("  Read failed")
	} else {
		fmt.Println("  Temp:", t1, "C  Humidity:", h1, "%  HeatIndex:", hi, "C")
	}

	fmt.Println("--- Sensor 2 (DHT11, pin 3) ---")
	if dht.IsNan(t2) || dht.IsNan(h2) {
		fmt.Println("  Read failed")
	} else {
		fmt.Println("  Temp:", t2, "C  Humidity:", h2, "%")
	}

	arduino.Delay(3000)
}
