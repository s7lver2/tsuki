// ─────────────────────────────────────────────────────────────────────────────
//  tsuki-flash :: boards  —  supported board database
// ─────────────────────────────────────────────────────────────────────────────

use std::fmt;

/// Which compiler/programmer family to use.
#[derive(Debug, Clone, PartialEq)]
pub enum Toolchain {
    /// AVR microcontrollers — avr-gcc + avrdude
    Avr {
        mcu:   &'static str,   // e.g. "atmega328p"
        f_cpu: u32,            // e.g. 16_000_000
        programmer: &'static str, // e.g. "arduino"
        baud:  u32,
    },
    /// Atmel SAM ARM — arm-none-eabi-gcc + bossac
    Sam {
        mcu: &'static str,
        f_cpu: u32,
    },
    /// Raspberry Pi RP2040 — arm-none-eabi-gcc + picotool/uf2
    Rp2040,
    /// Espressif ESP32 — xtensa-esp32-elf-gcc + esptool.py
    Esp32 {
        variant: &'static str, // e.g. "esp32", "esp32s2", "esp32c3"
    },
    /// Espressif ESP8266 — xtensa-lx106-elf-gcc + esptool.py
    Esp8266,
}

#[derive(Debug, Clone)]
pub struct Board {
    pub id:       &'static str,
    pub name:     &'static str,
    pub fqbn:     &'static str,
    pub variant:  &'static str,   // pins_arduino.h variant folder
    pub flash_kb: u32,
    pub ram_kb:   u32,
    pub toolchain: Toolchain,
    /// Compile-time defines specific to this board
    pub defines:  &'static [&'static str],
}

impl fmt::Display for Board {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.name, self.fqbn)
    }
}

impl Board {
    /// Return the board catalog.
    pub fn catalog() -> &'static [Board] {
        &BOARDS
    }

    /// Find a board by its short ID (case-insensitive).
    pub fn find(id: &str) -> Option<&'static Board> {
        let id_lower = id.to_lowercase();
        BOARDS.iter().find(|b| b.id.eq_ignore_ascii_case(&id_lower))
    }

    /// The `-mmcu` flag value (AVR only).
    pub fn avr_mcu(&self) -> Option<&'static str> {
        if let Toolchain::Avr { mcu, .. } = &self.toolchain {
            Some(mcu)
        } else {
            None
        }
    }

    /// CPU frequency in Hz.
    pub fn f_cpu(&self) -> u32 {
        match &self.toolchain {
            Toolchain::Avr { f_cpu, .. } => *f_cpu,
            Toolchain::Sam { f_cpu, .. } => *f_cpu,
            Toolchain::Rp2040            => 133_000_000,
            Toolchain::Esp32 { .. }      => 240_000_000,
            Toolchain::Esp8266           => 80_000_000,
        }
    }

    /// avrdude programmer type (AVR only).
    pub fn avrdude_programmer(&self) -> Option<(&'static str, u32)> {
        if let Toolchain::Avr { programmer, baud, .. } = &self.toolchain {
            Some((programmer, *baud))
        } else {
            None
        }
    }

    /// The sub-architecture string used in the Arduino SDK path.
    /// e.g.  "avr", "sam", "samd", "esp32", …
    pub fn arch(&self) -> &'static str {
        match &self.toolchain {
            Toolchain::Avr { .. }   => "avr",
            Toolchain::Sam { .. }   => "sam",
            Toolchain::Rp2040       => "rp2040",
            Toolchain::Esp32 { .. } => "esp32",
            Toolchain::Esp8266      => "esp8266",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Static board table
// ─────────────────────────────────────────────────────────────────────────────

static BOARDS: &[Board] = &[
    // ── AVR ───────────────────────────────────────────────────────────────────
    Board {
        id: "uno", name: "Arduino Uno",
        fqbn: "arduino:avr:uno",
        variant: "standard",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 16_000_000,
            programmer: "arduino", baud: 115200,
        },
        defines: &["ARDUINO_AVR_UNO", "ARDUINO_ARCH_AVR"],
    },
    Board {
        id: "nano", name: "Arduino Nano",
        fqbn: "arduino:avr:nano",
        variant: "eightanaloginputs",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 16_000_000,
            programmer: "arduino", baud: 115200,
        },
        defines: &["ARDUINO_AVR_NANO", "ARDUINO_ARCH_AVR"],
    },
    Board {
        id: "nano_old", name: "Arduino Nano (old bootloader)",
        fqbn: "arduino:avr:nano:cpu=atmega328old",
        variant: "eightanaloginputs",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 16_000_000,
            programmer: "arduino", baud: 57600,
        },
        defines: &["ARDUINO_AVR_NANO", "ARDUINO_ARCH_AVR"],
    },
    Board {
        id: "mega", name: "Arduino Mega 2560",
        fqbn: "arduino:avr:mega",
        variant: "mega",
        flash_kb: 256, ram_kb: 8,
        toolchain: Toolchain::Avr {
            mcu: "atmega2560", f_cpu: 16_000_000,
            programmer: "wiring", baud: 115200,
        },
        defines: &["ARDUINO_AVR_MEGA2560", "ARDUINO_ARCH_AVR"],
    },
    Board {
        id: "leonardo", name: "Arduino Leonardo",
        fqbn: "arduino:avr:leonardo",
        variant: "leonardo",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega32u4", f_cpu: 16_000_000,
            programmer: "avr109", baud: 57600,
        },
        defines: &["ARDUINO_AVR_LEONARDO", "ARDUINO_ARCH_AVR", "USB_VID=0x2341", "USB_PID=0x0036"],
    },
    Board {
        id: "micro", name: "Arduino Micro",
        fqbn: "arduino:avr:micro",
        variant: "micro",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega32u4", f_cpu: 16_000_000,
            programmer: "avr109", baud: 57600,
        },
        defines: &["ARDUINO_AVR_MICRO", "ARDUINO_ARCH_AVR", "USB_VID=0x2341", "USB_PID=0x0037"],
    },
    Board {
        id: "pro_mini_5v", name: "Arduino Pro Mini 5V",
        fqbn: "arduino:avr:pro:cpu=16MHzatmega328",
        variant: "eightanaloginputs",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 16_000_000,
            programmer: "arduino", baud: 57600,
        },
        defines: &["ARDUINO_AVR_PRO", "ARDUINO_ARCH_AVR"],
    },
    Board {
        id: "pro_mini_3v3", name: "Arduino Pro Mini 3.3V",
        fqbn: "arduino:avr:pro:cpu=8MHzatmega328",
        variant: "eightanaloginputs",
        flash_kb: 32, ram_kb: 2,
        toolchain: Toolchain::Avr {
            mcu: "atmega328p", f_cpu: 8_000_000,
            programmer: "arduino", baud: 57600,
        },
        defines: &["ARDUINO_AVR_PRO", "ARDUINO_ARCH_AVR"],
    },
    // ── ARM SAM ───────────────────────────────────────────────────────────────
    Board {
        id: "due", name: "Arduino Due",
        fqbn: "arduino:sam:arduino_due_x",
        variant: "arduino_due_x",
        flash_kb: 512, ram_kb: 96,
        toolchain: Toolchain::Sam {
            mcu: "cortex-m3", f_cpu: 84_000_000,
        },
        defines: &["ARDUINO_SAM_DUE", "ARDUINO_ARCH_SAM", "__SAM3X8E__"],
    },
    // ── RP2040 ────────────────────────────────────────────────────────────────
    Board {
        id: "pico", name: "Raspberry Pi Pico",
        fqbn: "rp2040:rp2040:rpipico",
        variant: "rpipico",
        flash_kb: 2048, ram_kb: 264,
        toolchain: Toolchain::Rp2040,
        defines: &["ARDUINO_RASPBERRY_PI_PICO", "ARDUINO_ARCH_RP2040"],
    },
    // ── ESP32 ─────────────────────────────────────────────────────────────────
    Board {
        id: "esp32", name: "ESP32 Dev Module",
        fqbn: "esp32:esp32:esp32",
        variant: "esp32",
        flash_kb: 4096, ram_kb: 520,
        toolchain: Toolchain::Esp32 { variant: "esp32" },
        defines: &["ARDUINO_ESP32_DEV", "ARDUINO_ARCH_ESP32", "ESP32"],
    },
    Board {
        id: "esp32s2", name: "ESP32-S2 Dev Module",
        fqbn: "esp32:esp32:esp32s2",
        variant: "esp32s2",
        flash_kb: 4096, ram_kb: 320,
        toolchain: Toolchain::Esp32 { variant: "esp32s2" },
        defines: &["ARDUINO_ESP32S2_DEV", "ARDUINO_ARCH_ESP32", "CONFIG_IDF_TARGET_ESP32S2"],
    },
    Board {
        id: "esp32c3", name: "ESP32-C3 Dev Module",
        fqbn: "esp32:esp32:esp32c3",
        variant: "esp32c3",
        flash_kb: 4096, ram_kb: 400,
        toolchain: Toolchain::Esp32 { variant: "esp32c3" },
        defines: &["ARDUINO_ESP32C3_DEV", "ARDUINO_ARCH_ESP32", "CONFIG_IDF_TARGET_ESP32C3"],
    },
    // ── ESP8266 ───────────────────────────────────────────────────────────────
    Board {
        id: "esp8266", name: "ESP8266 Generic",
        fqbn: "esp8266:esp8266:generic",
        variant: "esp8266",
        flash_kb: 1024, ram_kb: 80,
        toolchain: Toolchain::Esp8266,
        defines: &["ARDUINO_ESP8266_GENERIC", "ARDUINO_ARCH_ESP8266", "ESP8266"],
    },
    Board {
        id: "d1_mini", name: "Wemos D1 Mini",
        fqbn: "esp8266:esp8266:d1_mini",
        variant: "d1_mini",
        flash_kb: 4096, ram_kb: 80,
        toolchain: Toolchain::Esp8266,
        defines: &["ARDUINO_ESP8266_WEMOS_D1MINI", "ARDUINO_ARCH_ESP8266", "ESP8266"],
    },
    Board {
        id: "nodemcu", name: "NodeMCU 1.0 (ESP-12E)",
        fqbn: "esp8266:esp8266:nodemcuv2",
        variant: "nodemcu",
        flash_kb: 4096, ram_kb: 80,
        toolchain: Toolchain::Esp8266,
        defines: &["ARDUINO_ESP8266_NODEMCU_ESP12E", "ARDUINO_ARCH_ESP8266", "ESP8266"],
    },
];