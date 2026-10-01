# EcoGuard — Real-Time ESP32 Environmental Telemetry Dashboard

EcoGuard is a real-time IoT environmental monitoring dashboard that connects directly to a physical **ESP32 microcontroller** over USB Serial using the browser's native **Web Serial API**.

The application displays **strictly real sensor telemetry** parsed from the physical hardware stream, with zero synthetic, mock, or randomized values.

---

## Hardware Specifications & Pinout

| Sensor / Actuator | Parameter | ESP32 Pin | Interface / Protocol | Firmware Logic / Notes |
|---|---|---|---|---|
| **DHT22** | Temperature & Humidity | **GPIO 4** | 1-Wire Digital (`DHT.h`) | Sampling: ~2.0s • Threshold: > 34.0 °C |
| **MQ-135** | Air Quality Transducer | **GPIO 34** | ADC1_CH6 (Analog Input) | Raw 10-bit ADC Voltage (0–4095) • Unscaled |
| **NEO-6M GPS** | Geolocation & Constellation | **GPIO 26 (RX), 27 (TX)** | HardwareSerial `GPS(1)` | 9600 Baud • NMEA sentences (`TinyGPS++`) |
| **Piezo Buzzer** | Acoustic Hardware Alarm | **GPIO 25** | Digital Output | Active HIGH • Triggered when Temp > 34.0 °C |
| **PMS5003** | Particulate Matter (PM2.5) | Reserved | UART Laser Scattering | Reserved for future firmware revision |

**Default Serial Baud Rate:** `115200` (8N1)

---

## Data Pipeline

```
PHYSICAL ESP32 (Firmware Output)
             ↓
        USB SERIAL
             ↓
 Browser Web Serial API (Chrome / Edge)
             ↓
      Line Buffer Stream
             ↓
        ASCII Parser
             ↓
      Telemetry State
             ↓
     Dashboard UI & Charts
```

- **Exact Protocol Match**: Directly parses output lines emitted by the ESP32 firmware:
  - `Temperature: <value> C`
  - `Humidity: <value> %`
  - `Gas Analog Value: <value>`
  - `GPS: NO FIX` or `Latitude: <value>`, `Longitude: <value>`, `Satellites: <value>`
  - `BUZZER: ON - HIGH TEMPERATURE` & `BUZZER: OFF`
  - `DHT22: ERROR`
- **Firmware-Driven Alerts**: Web alerts are triggered **exclusively** when the ESP32 emits `BUZZER: ON - HIGH TEMPERATURE` and cleared upon receiving `BUZZER: OFF`. Temperature readings alone never generate invented alerts.
- **Raw MQ-135 Readings**: Raw ADC values are preserved directly without uncalibrated conversions to PPM or AQI.

---

## Key Features

- **Real-Time Sensor Cards**:
  - DHT22 Ambient Temperature (°C)
  - DHT22 Relative Humidity (%)
  - MQ-135 Raw Transducer ADC Value
  - NEO-6M GPS Geolocation (`NO FIX` or actual Latitude & Longitude)
  - Satellite Constellation Count
  - Hardware Buzzer Status (`ACTIVE` / `OFF`)
  - PMS5003 Particulate Card (`COMING SOON`)
- **Live Raw Serial Monitor**: Embedded terminal displaying incoming serial text in real-time with a **Clear Terminal** button.
- **Strict Disconnected State**: Displays `ESP32 DISCONNECTED` and `--` until real data arrives. Never displays fake fallback telemetry.
- **Telemetry History & Charts**: Technical SVG waveforms plotting strictly recorded data frames.
- **Diagnostic Reports & CSV Export**: Statistical aggregates and RFC 4180 CSV export generated only from stored real readings.
- **Developer Simulation Mode**: Isolated in Settings for offline UI testing; strictly disabled by default.

---

## How to Run

### 1. Requirements
- A modern browser with **Web Serial API** support: **Google Chrome** or **Microsoft Edge**.
- ESP32 running the EcoGuard firmware connected via USB.

### 2. Start Local Server

You can serve the project using Node.js or Python:

```bash
# Option A: Using Node.js
node server.js

# Option B: Using Python
python -m http.server 3000
```

Open your browser and navigate to:
```
http://localhost:3000
```

### 3. Connect to the ESP32

> [!IMPORTANT]
> **Close the Arduino IDE Serial Monitor before connecting.** The Arduino IDE and the browser cannot share the COM port at the same time.

1. Click **Connect ESP32** in the top navigation bar.
2. Select your ESP32 COM port in the browser prompt.
3. The dashboard will show `CONNECTED — WAITING FOR DATA` and transition to `ESP32 CONNECTED` as soon as real telemetry frames arrive.
4. Watch real-time lines appear in the **Live Raw Serial Monitor** and watch the sensor cards update.

---

## Visual Design

Built with the **Stitch Design System** palette:
- **Venice Blue (`#16587B`)**: Primary telemetry accents, active indicators, chart traces.
- **Rock Blue (`#84B3CE`)**: Grid lines, secondary borders, subheads.
- **Merino (`#F5EEDD`)**: Surface and background container.
- **Typography**: Space Grotesk (Headings) & JetBrains Mono (Telemetry displays & raw terminal).
