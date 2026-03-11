package main

import (
	"arduino"
	"fmt"
	"stepper"
)

const (
	stepPin = 2
	dirPin  = 3
)

// NEMA17 with A4988 driver — DRIVER mode (STEP + DIR pins)
var motor = stepper.New(stepper.DRIVER, stepPin, dirPin)

func setup() {
	arduino.Serial.Begin(9600)
	motor.SetMaxSpeed(1000.0)
	motor.SetAcceleration(500.0)
	fmt.Println("Stepper ready")
}

func loop() {
	// Rotate 200 steps forward (1 full revolution for 1.8° stepper)
	motor.MoveTo(200)
	for motor.DistanceToGo() != 0 {
		motor.Run()
	}
	fmt.Println("Forward done")
	arduino.Delay(500)

	// Rotate back to 0
	motor.MoveTo(0)
	for motor.DistanceToGo() != 0 {
		motor.Run()
	}
	fmt.Println("Back to zero")
	arduino.Delay(500)
}
