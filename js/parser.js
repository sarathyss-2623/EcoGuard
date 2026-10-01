/**
 * EcoGuard IoT Environmental Monitoring System
 * Serial Data Parser for Physical ESP32 Firmware Output
 *
 * STRICT REQUIREMENT:
 * Directly parses real ASCII lines from the ESP32 USB serial stream.
 * No synthetic, interpolated, or simulated data.
 */

export class ESP32Parser {
  constructor(onReadingComplete, onRawLine) {
    this.onReadingComplete = onReadingComplete || (() => {});
    this.onRawLine = onRawLine || (() => {});
    this.buffer = '';
    this.currentCycle = this.createEmptyCycle();
    this.hasActiveFields = false;
    this.emitTimer = null;
  }

  createEmptyCycle() {
    return {
      temperature: null,
      humidity: null,
      dhtError: false,
      gasAnalog: null,
      gps: {
        hasFix: null,
        latitude: null,
        longitude: null,
        satellites: null,
      },
      buzzerState: null,
      buzzerReason: '',
      timestamp: null,
    };
  }

  /**
   * Feed a raw text chunk received from Web Serial API
   * Handles partial line chunking via persistent line buffer
   */
  feed(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep incomplete trailing line in the buffer
    this.buffer = lines.pop();

    for (const rawLine of lines) {
      // Preserve exact line content (removing carriage return only)
      const cleanRaw = rawLine.replace(/\r$/, '');
      this.onRawLine(cleanRaw);

      const trimmed = cleanRaw.trim();
      if (trimmed.length > 0) {
        this.parseLine(trimmed);
      }
    }

    // Debounce safety timer: if ESP32 sends a frame without trailing === delimiter,
    // emit the completed reading after 600ms of serial silence
    if (this.hasActiveFields) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = setTimeout(() => {
        if (this.hasActiveFields) {
          this.emitCycle();
        }
      }, 600);
    }
  }

  /**
   * Process an individual line of ESP32 serial output
   */
  parseLine(line) {
    // Delimiters indicating end or beginning of a test frame:
    // e.g. "================================" or "   SENSOR COMBINED TEST"
    if (line.startsWith('====') || line.includes('SENSOR COMBINED TEST')) {
      if (this.hasActiveFields) {
        this.emitCycle();
      }
      return;
    }

    // Ignore section headers like "--- DHT22 ---", "--- MQ-135 ---", "--- GPS ---", "--- Buzzer ---"
    if (line.startsWith('---')) {
      return;
    }

    // 1. DHT22: Temperature (e.g. "Temperature: 34.20 C")
    const tempMatch = line.match(/^Temperature:\s*([0-9.-]+)\s*C/i);
    if (tempMatch) {
      this.currentCycle.temperature = parseFloat(tempMatch[1]);
      this.currentCycle.dhtError = false;
      this.hasActiveFields = true;
      return;
    }

    // 2. DHT22: Humidity (e.g. "Humidity: 73.10 %")
    const humMatch = line.match(/^Humidity:\s*([0-9.-]+)\s*%/i);
    if (humMatch) {
      this.currentCycle.humidity = parseFloat(humMatch[1]);
      this.currentCycle.dhtError = false;
      this.hasActiveFields = true;
      return;
    }

    // 3. DHT22: Sensor Fault (e.g. "DHT22: ERROR")
    if (line.includes('DHT22: ERROR')) {
      this.currentCycle.dhtError = true;
      this.currentCycle.temperature = null;
      this.currentCycle.humidity = null;
      this.hasActiveFields = true;
      return;
    }

    // 4. MQ-135: Raw Analog ADC (e.g. "Gas Analog Value: 592")
    const gasMatch = line.match(/^Gas Analog Value:\s*([0-9]+)/i);
    if (gasMatch) {
      this.currentCycle.gasAnalog = parseInt(gasMatch[1], 10);
      this.hasActiveFields = true;
      return;
    }

    // 5. GPS: Fix Status (e.g. "GPS: NO FIX")
    if (line.includes('GPS: NO FIX')) {
      this.currentCycle.gps.hasFix = false;
      this.currentCycle.gps.latitude = null;
      this.currentCycle.gps.longitude = null;
      this.hasActiveFields = true;
      return;
    }

    // 6. GPS: Coordinates (e.g. "Latitude: 13.082680", "Longitude: 80.270718")
    const latMatch = line.match(/^Latitude:\s*([0-9.-]+)/i);
    if (latMatch) {
      this.currentCycle.gps.latitude = parseFloat(latMatch[1]);
      this.currentCycle.gps.hasFix = true;
      this.hasActiveFields = true;
      return;
    }

    const lngMatch = line.match(/^Longitude:\s*([0-9.-]+)/i);
    if (lngMatch) {
      this.currentCycle.gps.longitude = parseFloat(lngMatch[1]);
      this.currentCycle.gps.hasFix = true;
      this.hasActiveFields = true;
      return;
    }

    // 7. GPS: Satellite Count (e.g. "Satellites: 0" or "Satellites: 6")
    const satMatch = line.match(/^Satellites:\s*([0-9]+)/i);
    if (satMatch) {
      this.currentCycle.gps.satellites = parseInt(satMatch[1], 10);
      this.hasActiveFields = true;
      return;
    }

    // 8. Buzzer State: EXACT firmware protocol
    // "BUZZER: ON - HIGH TEMPERATURE"
    if (line.includes('BUZZER: ON - HIGH TEMPERATURE')) {
      this.currentCycle.buzzerState = 'ON';
      this.currentCycle.buzzerReason = 'HIGH TEMPERATURE';
      this.hasActiveFields = true;
      return;
    }

    // "BUZZER: OFF"
    if (line.includes('BUZZER: OFF')) {
      this.currentCycle.buzzerState = 'OFF';
      this.currentCycle.buzzerReason = '';
      this.hasActiveFields = true;
      return;
    }
  }

  emitCycle() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.currentCycle.timestamp = new Date();
    this.onReadingComplete({ ...this.currentCycle, gps: { ...this.currentCycle.gps } });
    this.currentCycle = this.createEmptyCycle();
    this.hasActiveFields = false;
  }

  reset() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.buffer = '';
    this.currentCycle = this.createEmptyCycle();
    this.hasActiveFields = false;
  }
}
