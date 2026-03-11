package main

import (
	"arduino"
	"fmt"
	"stepper"
)

const (
	stepPin   = 2
	dirPin    = 3
	potPin    = 0 // A0 potentiometer for speed control
)

var motor = stepper.New(stepper.DRIVER, stepPin, dirPin)

func setup() {
	arduino.Serial.Begin(9600)
	motor.SetMaxSpeed(2000.0)
	motor.SetAcceleration(1000.0)
	fmt.Println("Speed-controlled stepper ready")
}

func loop() {
	// Read potentiometer (0–1023) and map to speed (-1000..+1000 steps/s)
	raw   := arduino.AnalogRead(potPin)
	speed := float32(raw-512) * 2.0  // center = 0, extremes = ±1024

	motor.SetSpeed(speed)
	motor.RunSpeed()

	// Print speed every 200ms without blocking the motor loop
	if arduino.Millis()%200 == 0 {
		fmt.Println("Speed:", motor.Speed(), "steps/s  Pos:", motor.CurrentPosition())
	}
}
