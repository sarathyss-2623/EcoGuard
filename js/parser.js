/**
 * EcoGuard IoT Environmental Monitoring System
 * Serial Data Parser for Physical ESP32 Firmware Output
 *
 * STRICT REQUIREMENT:
 * Directly parses real ASCII lines from the ESP32 USB serial stream.
 * No synthetic, interpolated, or simulated data.
 */

const PROFILES = new Set(['GENERAL', 'OLDER_ADULT', 'PREGNANT', 'CHILD_UNDER_FIVE', 'ASTHMA']);
const RISK_LEVELS = new Set(['NORMAL', 'CAUTION', 'HIGH', 'CRITICAL', 'UNKNOWN']);

export class ESP32Parser {
  constructor(onReadingComplete, onRawLine, onInvalidMessage, onCommandResult) {
    this.onReadingComplete = onReadingComplete || (() => {});
    this.onRawLine = onRawLine || (() => {});
    this.onInvalidMessage = onInvalidMessage || (() => {});
    this.onCommandResult = onCommandResult || (() => {});
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
    if (line.startsWith('{')) {
      let normalized;
      try {
        const payload = JSON.parse(line);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Expected a JSON object');
        if (payload.message_type === 'command_result') {
          this.onCommandResult(this.normalizeCommandResult(payload));
          return true;
        }
        if (payload.message_type && payload.message_type !== 'telemetry') return false;
        normalized = this.normalizeJson(payload);
      } catch (error) {
        this.onInvalidMessage(line, error);
        return false;
      }
      this.onReadingComplete(normalized);
      return true;
    }

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

  normalizeJson(payload) {
    const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max ? value : null;
    const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : null;
    const dhtValid = payload.dht_valid === true;
    const temperature = dhtValid ? number(payload.temperature, -40, 80) : null;
    const humidity = dhtValid ? number(payload.humidity, 0, 100) : null;
    const dhtError = !dhtValid || temperature === null || humidity === null;
    const gpsFix = payload.gps_fix === true;
    const latitude = gpsFix ? number(payload.latitude, -90, 90) : null;
    const longitude = gpsFix ? number(payload.longitude, -180, 180) : null;
    const validGps = gpsFix && latitude !== null && longitude !== null;
    const providedRisk = typeof payload.risk_level === 'string' ? payload.risk_level.trim().toUpperCase() : 'UNKNOWN';
    let riskLevel = RISK_LEVELS.has(providedRisk) ? providedRisk : 'UNKNOWN';
    let riskReason = typeof payload.risk_reason === 'string' ? payload.risk_reason.trim().slice(0, 240) : '';
    if (!dhtValid && riskLevel === 'NORMAL') {
      riskLevel = 'UNKNOWN';
      riskReason = `DHT22 unavailable; firmware NORMAL assessment not confirmed. ${riskReason}`.trim();
    }
    const thresholdKeys = ['temperature_caution', 'temperature_high', 'temperature_extreme', 'humidity_low', 'humidity_high', 'humidity_extreme', 'heat_index_caution', 'heat_index_high', 'heat_index_extreme'];
    const thresholds = {};
    if (payload.thresholds && typeof payload.thresholds === 'object' && !Array.isArray(payload.thresholds)) {
      thresholdKeys.forEach(key => { const value = number(payload.thresholds[key], 0, 100); if (value !== null) thresholds[key] = value; });
    }
    const patientProfiles = Array.isArray(payload.patient_profiles) ? payload.patient_profiles.flatMap(profile => {
      if (!profile || !PROFILES.has(profile.name)) return [];
      return [{ name: profile.name, temperatureThreshold: number(profile.temperature_threshold, -40, 80), active: typeof profile.active === 'boolean' ? profile.active : null }];
    }) : [];
    const calculation = payload.human_calculation && typeof payload.human_calculation === 'object' && !Array.isArray(payload.human_calculation) ? payload.human_calculation : {};
    const reportedProfile = typeof payload.patient_profile === 'string' ? payload.patient_profile.trim().toUpperCase() : '';
    const calculatedProfile = typeof calculation.profile === 'string' ? calculation.profile.trim().toUpperCase() : '';
    const patientProfile = PROFILES.has(reportedProfile) ? reportedProfile : PROFILES.has(calculatedProfile) ? calculatedProfile : 'UNKNOWN';
    const patientTemperatureThreshold = number(payload.patient_temperature_threshold, -40, 80) ?? number(calculation.temperature_threshold, -40, 80);
    const calculationValid = !dhtError && calculation.temperature_valid !== false;
    const humanCalculation = {
      profile: PROFILES.has(typeof calculation.profile === 'string' ? calculation.profile.trim().toUpperCase() : '') ? calculation.profile.trim().toUpperCase() : patientProfile,
      temperatureThreshold: calculationValid ? number(calculation.temperature_threshold, -40, 80) ?? patientTemperatureThreshold : null,
      temperatureValid: !dhtError && typeof calculation.temperature_valid === 'boolean' ? calculation.temperature_valid : dhtError ? false : null,
      thresholdCrossed: calculationValid && typeof calculation.threshold_crossed === 'boolean' ? calculation.threshold_crossed : null,
      measuredTemperature: calculationValid ? number(calculation.measured_temperature, -40, 80) : null,
      temperatureDifference: calculationValid ? number(calculation.temperature_difference, -160, 160) : null,
      temperatureUnit: typeof calculation.temperature_unit === 'string' ? calculation.temperature_unit.trim().slice(0, 12) : null,
    };
    return {
      protocol: 'json', messageType: 'telemetry', timestamp: new Date(), deviceTimestampMs: number(payload.timestamp_ms, 0, Number.MAX_SAFE_INTEGER),
      deviceId: typeof payload.device_id === 'string' ? payload.device_id.slice(0, 80) : null,
      transport: payload.transport === 'USB_SERIAL' ? 'USB_SERIAL' : null,
      temperature, humidity, dhtError,
      heatIndex: dhtError ? null : number(payload.heat_index, -80, 150), gasAnalog: integer(payload.mq135_raw, 0, 4095),
      gps: { hasFix: payload.gps_fix === false ? false : validGps, latitude: validGps ? latitude : null, longitude: validGps ? longitude : null, satellites: integer(payload.satellites, 0, 99) },
      patientProfile, patientTemperatureThreshold, patientProfiles, humanCalculation, thresholds,
      riskLevel, riskReason, buzzerState: typeof payload.buzzer_on === 'boolean' ? (payload.buzzer_on ? 'ON' : 'OFF') : null,
      buzzerTrigger: typeof payload.buzzer_trigger === 'string' ? payload.buzzer_trigger.trim().slice(0, 120) : null,
    };
  }

  normalizeCommandResult(payload) {
    const rawProfile = typeof payload.patient_profile === 'string' ? payload.patient_profile.trim().toUpperCase() : '';
    const threshold = Number.isFinite(payload.patient_temperature_threshold) && payload.patient_temperature_threshold >= -40 && payload.patient_temperature_threshold <= 80
      ? payload.patient_temperature_threshold : null;
    return {
      success: typeof payload.success === 'boolean' ? payload.success : false,
      message: typeof payload.message === 'string' ? payload.message.trim().slice(0, 240) : '',
      patientProfile: PROFILES.has(rawProfile) ? rawProfile : null,
      patientTemperatureThreshold: threshold,
    };
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
