package main

import (
	"arduino"
	"fmt"
	"math"
	"mpu6050"
	"servo"
)

const (
	servoPin  = 9
	servoMin  = 0
	servoMax  = 180
)

var (
	imu  = mpu6050.New()
	srv  = servo.New()
)

func setup() {
	arduino.Serial.Begin(9600)
	srv.Attach(servoPin)

	if !imu.Begin() {
		fmt.Println("MPU6050 not found!")
		for {
			arduino.Delay(1000)
		}
	}
	imu.SetAccelerometerRange(mpu6050.RANGE_2_G)
	imu.SetFilterBandwidth(mpu6050.BAND_10_HZ)
	fmt.Println("Tilt servo ready")
}

func loop() {
	var a, g, t arduino.SensorsEvent
	imu.GetEvent(a, g, t)

	ax := mpu6050.AccelX(a)
	ay := mpu6050.AccelY(a)

	// Compute tilt angle from X-axis (degrees)
	tiltDeg := math.Atan2(ax, ay) * 180.0 / math.Pi

	// Map -90..90 degrees to 0..180 servo position
	pos := int(tiltDeg + 90.0)
	if pos < servoMin {
		pos = servoMin
	}
	if pos > servoMax {
		pos = servoMax
	}

	srv.Write(pos)
	fmt.Println("Tilt:", tiltDeg, "°  Servo:", pos)
	arduino.Delay(20)
}
