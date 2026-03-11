package main

import (
	"arduino"
	"fmt"
	"mpu6050"
)

var imu = mpu6050.New()

func setup() {
	arduino.Serial.Begin(115200)

	if !imu.Begin() {
		fmt.Println("MPU6050 not found — check wiring!")
		for {
			arduino.Delay(1000)
		}
	}

	imu.SetAccelerometerRange(mpu6050.RANGE_8_G)
	imu.SetGyroRange(mpu6050.RANGE_500_DEG)
	imu.SetFilterBandwidth(mpu6050.BAND_21_HZ)

	fmt.Println("MPU6050 ready")
	arduino.Delay(100)
}

func loop() {
	var a, g, t arduino.SensorsEvent
	imu.GetEvent(a, g, t)

	fmt.Println("Accel X:", mpu6050.AccelX(a), "Y:", mpu6050.AccelY(a), "Z:", mpu6050.AccelZ(a), "m/s^2")
	fmt.Println("Gyro  X:", mpu6050.GyroX(g), "Y:", mpu6050.GyroY(g), "Z:", mpu6050.GyroZ(g), "rad/s")
	fmt.Println("Temp    :", mpu6050.Temp(t), "C")
	fmt.Println("---")
	arduino.Delay(500)
}
