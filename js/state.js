/**
 * EcoGuard IoT Environmental Monitoring System
 * Application State & History Storage
 *
 * STRICT REQUIREMENT:
 * Absolutely NO fake or mock sensor telemetry.
 * All state is populated strictly from physical ESP32 serial frames.
 */

const STORAGE_KEY_HISTORY = 'ecoguard_real_telemetry_history_v2';
const STORAGE_KEY_ALERTS = 'ecoguard_real_alerts_history_v2';
const STORAGE_KEY_SETTINGS = 'ecoguard_settings_v2';
import { assessEnvironment } from './risk-engine.mjs';
const MAX_HISTORY_POINTS = 1000;

export const state = {
  connection: {
    status: 'disconnected', // 'connected' | 'disconnected' | 'connecting' | 'connected-waiting' | 'error'
    baudRate: 115200,
    portName: null,
    lastUpdate: null,
    lastUpdateString: null,
    connectedAt: null,
    isSimulated: false,
    profileCommandStatus: { status: 'idle', message: '' },
  },
  current: {
    temperature: null,
    humidity: null,
    dhtError: false,
    gasAnalog: null,
    heatIndex: null,
    riskLevel: 'UNKNOWN',
    riskReason: '',
    patientProfile: 'UNKNOWN',
    patientTemperatureThreshold: null,
    humanCalculation: { profile: 'UNKNOWN', temperatureThreshold: null, temperatureValid: null, thresholdCrossed: null, measuredTemperature: null, temperatureDifference: null, temperatureUnit: null },
    thresholds: {},
    patientProfiles: [],
    protocol: null,
    gps: {
      hasFix: null, // null = waiting for data, true = fix, false = NO FIX
      latitude: null,
      longitude: null,
      satellites: null,
      lastFixTime: null,
    },
    buzzer: {
      state: 'WAITING', // 'WAITING' | 'OFF' | 'ACTIVE'
      reason: '',
      triggerTime: null,
    },
  },
  activeAlert: null,
  hardwareAlert: null,
  heatAssessment: null,
  history: [],
  alertsHistory: [],
  settings: {
    tempThreshold: 34.0, // Hardware setpoint reference on ESP32
    displayUnit: 'C',
    maxHistoryBuffer: 500,
    profiles: ['general'],
  },
  listeners: [],
};

// Subscribe to state changes
export function subscribe(fn) {
  state.listeners.push(fn);
  return () => {
    state.listeners = state.listeners.filter(l => l !== fn);
  };
}

export function notify(event, payload) {
  for (const listener of state.listeners) {
    try {
      listener(event, payload, state);
    } catch (err) {
      console.error('State listener error:', err);
    }
  }
}

// Load real state from localStorage (never seed fake items)
export function initStore() {
  try {
    // Purge any legacy fake seeded storage from previous iterations
    localStorage.removeItem('ecoguard_telemetry_history_v1');
    localStorage.removeItem('ecoguard_alerts_history_v1');

    const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (savedHistory) {
      state.history = JSON.parse(savedHistory);
    } else {
      state.history = [];
    }

    const savedAlerts = localStorage.getItem(STORAGE_KEY_ALERTS);
    if (savedAlerts) {
      state.alertsHistory = JSON.parse(savedAlerts);
    } else {
      state.alertsHistory = [];
    }

    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      Object.assign(state.settings, JSON.parse(savedSettings));
    }
  } catch (err) {
    console.warn('Could not load stored telemetry state:', err);
    state.history = [];
    state.alertsHistory = [];
  }
}

export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(state.history.slice(-MAX_HISTORY_POINTS)));
    localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(state.alertsHistory.slice(-256)));
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
  } catch (err) {
    console.warn('Storage save failed:', err);
  }
}

/**
 * Record a complete sensor cycle received from ESP32
 */
export function recordReading(reading) {
  const timestamp = new Date();
  const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.connection.lastUpdate = timestamp;
  state.connection.lastUpdateString = timeString;
  state.connection.status = 'receiving';
  const firmwareReading = reading.protocol === 'json';
  state.current.protocol = reading.protocol || 'legacy';
  let heatRuleActive = false;
  let heatAlert = null;
  if (firmwareReading) {
    state.heatAssessment = null;
    state.current.dhtError = reading.dhtError === true;
    state.current.temperature = reading.temperature;
    state.current.humidity = reading.humidity;
    state.current.gasAnalog = reading.gasAnalog;
    state.current.heatIndex = reading.heatIndex;
    state.current.gps = { ...reading.gps, lastFixTime: reading.gps.hasFix ? timestamp : state.current.gps.lastFixTime };
    state.current.buzzer = { state: reading.buzzerState === 'ON' ? 'ACTIVE' : reading.buzzerState === 'OFF' ? 'OFF' : 'WAITING', reason: reading.buzzerTrigger || reading.riskReason || '', triggerTime: reading.buzzerState === 'ON' ? timestamp : null };
    state.current.riskLevel = reading.riskLevel;
    state.current.riskReason = reading.riskReason;
    state.current.patientProfile = reading.patientProfile;
    state.current.patientTemperatureThreshold = reading.patientTemperatureThreshold;
    state.current.thresholds = reading.thresholds;
    state.current.patientProfiles = reading.patientProfiles;
    state.current.humanCalculation = { ...reading.humanCalculation };
    const validRiskInputs = !reading.dhtError && Number.isFinite(reading.temperature) && Number.isFinite(reading.humidity);
    const riskActive = reading.buzzerState === 'ON' || (validRiskInputs && ['CAUTION', 'HIGH', 'CRITICAL'].includes(reading.riskLevel));
    const firmwareAlert = state.alertsHistory.find(a => a.ruleId === 'esp32-risk-v1' && a.status === 'active');
    if (riskActive) {
      heatAlert = firmwareAlert;
      if (!heatAlert) {
        heatAlert = { id: 'esp32-' + timestamp.getTime(), ruleId: 'esp32-risk-v1', hazard: 'firmware-risk', timestamp: timestamp.toISOString(), displayTime: timeString, acknowledged: false, ackTime: null, status: 'active' };
        state.alertsHistory.unshift(heatAlert);
        notify('alert_triggered', heatAlert);
      }
      Object.assign(heatAlert, { event: `ESP32 RISK ${reading.riskLevel}`, updatedAt: timestamp.toISOString(), temperature: reading.temperature, humidity: reading.humidity, heatIndexC: reading.heatIndex, severity: reading.riskLevel, riskReason: reading.riskReason, patientProfile: reading.patientProfile, patientTemperatureThreshold: reading.patientTemperatureThreshold, buzzerOn: reading.buzzerState === 'ON' ? true : reading.buzzerState === 'OFF' ? false : null, thresholds: reading.thresholds, resolutionPending: false });
    } else if (firmwareAlert && reading.riskLevel === 'NORMAL' && reading.buzzerState === 'OFF' && !reading.dhtError) {
      Object.assign(firmwareAlert, { status: 'resolved', resolvedAt: timestamp.toISOString(), resolutionPending: false });
    } else if (firmwareAlert) {
      Object.assign(firmwareAlert, { riskReason: reading.riskReason || 'Current risk cannot be confirmed from this message.', patientProfile: reading.patientProfile, patientTemperatureThreshold: reading.patientTemperatureThreshold, buzzerOn: reading.buzzerState === 'ON' ? true : reading.buzzerState === 'OFF' ? false : null, resolutionPending: true });
    }
    state.activeAlert = riskActive ? heatAlert : (firmwareAlert?.status === 'active' ? firmwareAlert : state.hardwareAlert);
  } else {
    state.current.riskLevel = 'UNKNOWN';
    state.current.riskReason = '';
    state.current.patientProfile = 'UNKNOWN';
    state.current.patientTemperatureThreshold = null;
    state.current.humanCalculation = { profile: 'UNKNOWN', temperatureThreshold: null, temperatureValid: null, thresholdCrossed: null, measuredTemperature: null, temperatureDifference: null, temperatureUnit: null };
    state.current.humanCalculation = { profile: 'UNKNOWN', temperatureThreshold: null, temperatureValid: null, thresholdCrossed: null, measuredTemperature: null, temperatureDifference: null, temperatureUnit: null };
    state.current.thresholds = {};
    state.current.patientProfiles = [];
    state.current.heatIndex = null;
    state.heatAssessment = assessEnvironment({ temperature: reading.dhtError ? null : reading.temperature, humidity: reading.dhtError ? null : reading.humidity, gasAnalog: reading.gasAnalog, timestamp: reading.timestamp });
    heatRuleActive = state.heatAssessment.triggeredRules.length > 0;
    heatAlert = state.alertsHistory.find(a => a.ruleId === 'nws-heat-index-v1' && a.status === 'active');
  }
  if (!firmwareReading && heatRuleActive) {
    if (!heatAlert) {
      heatAlert = { id: 'heat-' + timestamp.getTime(), ruleId: 'nws-heat-index-v1', hazard: 'heat', timestamp: timestamp.toISOString(), displayTime: timeString, event: `HEAT ${state.heatAssessment.riskLevel.toUpperCase()}`, severity: state.heatAssessment.riskLevel, status: 'active', acknowledged: false, ackTime: null };
      state.alertsHistory.unshift(heatAlert);
      notify('alert_triggered', heatAlert);
    }
    Object.assign(heatAlert, { updatedAt: timestamp.toISOString(), event: `HEAT ${state.heatAssessment.riskLevel.toUpperCase()}`, temperature: reading.temperature, humidity: reading.humidity, heatIndexC: state.heatAssessment.heatIndexC, thresholdC: state.heatAssessment.thresholdC, severity: state.heatAssessment.riskLevel, relevantGroups: state.settings.profiles.filter(profile => profile !== 'general'), recommendedActions: state.heatAssessment.recommendedActions, assessment: state.heatAssessment });
    state.activeAlert = heatAlert;
  } else if (!firmwareReading) {
    if (heatAlert && state.heatAssessment.dataQuality === 'valid') {
      heatAlert.status = 'resolved';
      heatAlert.resolvedAt = timestamp.toISOString();
      state.activeAlert = state.hardwareAlert;
    } else {
      if (heatAlert) Object.assign(heatAlert, { dataQuality: state.heatAssessment.dataQuality, resolutionPending: true, assessment: state.heatAssessment });
      state.activeAlert = heatAlert || state.hardwareAlert;
    }
  }

  // 1. DHT22 Processing
  if (firmwareReading) {
    // The JSON payload is a full snapshot; nulls clear old sensor values.
  } else if (reading.dhtError === true) {
    state.current.dhtError = true;
    state.current.temperature = null;
    state.current.humidity = null;
  } else {
    state.current.dhtError = false;
    if (Number.isFinite(reading.temperature) && reading.temperature >= -40 && reading.temperature <= 80) {
      state.current.temperature = reading.temperature;
    }
    if (Number.isFinite(reading.humidity) && reading.humidity >= 0 && reading.humidity <= 100) {
      state.current.humidity = reading.humidity;
    }
  }

  // 2. MQ-135 Processing (Strict raw ADC value only)
  if (!firmwareReading && Number.isInteger(reading.gasAnalog) && reading.gasAnalog >= 0 && reading.gasAnalog <= 4095) {
    state.current.gasAnalog = reading.gasAnalog;
  }

  // 3. GPS Processing
  if (!firmwareReading && reading.gps) {
    const gpsValid = Number.isFinite(reading.gps.latitude) && Math.abs(reading.gps.latitude) <= 90 && Number.isFinite(reading.gps.longitude) && Math.abs(reading.gps.longitude) <= 180;
    state.current.gps.hasFix = reading.gps.hasFix === true && gpsValid;
    state.current.gps.satellites = Number.isInteger(reading.gps.satellites) && reading.gps.satellites >= 0 ? reading.gps.satellites : null;
    state.current.gps.latitude = gpsValid ? reading.gps.latitude : null;
    state.current.gps.longitude = gpsValid ? reading.gps.longitude : null;
    if (reading.gps.hasFix) {
      state.current.gps.lastFixTime = timestamp;
    }
  }

  // 4. Hardware Buzzer Alert Logic:
  // MANDATORY: Driven EXCLUSIVELY by ESP32 buzzer message!
  // "BUZZER: ON - HIGH TEMPERATURE" creates active alert
  // "BUZZER: OFF" clears active alert
  // Temperature alone NEVER triggers an alert!
  if (!firmwareReading && reading.buzzerState) {
    const isBuzzerOn = reading.buzzerState === 'ON';
    state.current.buzzer.state = isBuzzerOn ? 'ACTIVE' : 'OFF';
    state.current.buzzer.reason = isBuzzerOn ? (reading.buzzerReason || 'HIGH TEMPERATURE') : '';

    if (isBuzzerOn) {
      if (!state.hardwareAlert) {
        state.hardwareAlert = {
          id: 'alert-' + timestamp.getTime(),
          timestamp: timestamp.toISOString(),
          displayTime: timeString,
          temperature: state.current.temperature,
          threshold: 34.0,
          acknowledged: false,
          ackTime: null,
          event: 'HIGH TEMPERATURE', status: 'active', hazard: 'hardware-temperature',
        };
        if (!state.activeAlert) state.activeAlert = state.hardwareAlert;

        state.alertsHistory.unshift({
          id: state.hardwareAlert.id,
          timestamp: timestamp.toISOString(),
          displayTime: timeString,
          event: 'HIGH TEMPERATURE', status: 'active', hazard: 'hardware-temperature',
          hardwareBuzzer: 'ACTIVE',
          acknowledged: false,
          ackTime: null,
          audit: 'Unacknowledged',
          temperature: state.current.temperature,
        });

        notify('alert_triggered', state.hardwareAlert);
      }
    } else {
      // Buzzer is OFF: Clear active hardware alert immediately
      if (state.hardwareAlert) {
        const clearedAlert = state.hardwareAlert;
        clearedAlert.status = 'resolved';
        clearedAlert.resolvedAt = timestamp.toISOString();
        state.hardwareAlert = null;
        const logged = state.alertsHistory.find(a => a.id === clearedAlert.id);
        if (logged) Object.assign(logged, { status: 'resolved', resolvedAt: timestamp.toISOString() });
        state.activeAlert = heatAlert?.status === 'active' ? heatAlert : null;
        notify('alert_cleared', clearedAlert);
      }
    }
  }

  // Append real entry to history buffer
  const historyEntry = {
    id: 'h-' + timestamp.getTime(),
    timestamp: timestamp.toISOString(),
    displayTime: timeString,
    temperature: firmwareReading ? state.current.temperature : state.heatAssessment.temperatureC,
    humidity: firmwareReading ? state.current.humidity : state.heatAssessment.humidityPercent,
    dhtError: state.current.dhtError,
    gasAnalog: firmwareReading ? state.current.gasAnalog : state.heatAssessment.gasSensor.rawAdc,
    gpsFix: state.current.gps.hasFix,
    latitude: state.current.gps.latitude,
    longitude: state.current.gps.longitude,
    satellites: state.current.gps.satellites,
    buzzerState: state.current.buzzer.state,
    alertActive: state.current.buzzer.state === 'ACTIVE',
    heatAlertActive: heatRuleActive,
    heatAlertActive: heatRuleActive || (firmwareReading && ['CAUTION','HIGH','CRITICAL'].includes(state.current.riskLevel)),
    heatIndexC: firmwareReading ? state.current.heatIndex : state.heatAssessment.heatIndexC,
    heatRiskLevel: firmwareReading ? state.current.riskLevel : state.heatAssessment.riskLevel,
    patientProfile: state.current.patientProfile,
    patientTemperatureThreshold: state.current.patientTemperatureThreshold,
    humanCalculation: { ...state.current.humanCalculation },
    patientProfiles: state.current.patientProfiles.map(profile => ({ ...profile })),
    thresholds: state.current.thresholds,
    riskReason: state.current.riskReason,
  };

  state.history.push(historyEntry);
  if (state.history.length > MAX_HISTORY_POINTS) {
    state.history.shift();
  }

  saveState();
  notify('reading_recorded', historyEntry);
}

export function expireStaleAssessment() {
  if (!state.heatAssessment || state.heatAssessment.dataQuality === 'unavailable' || !state.connection.lastUpdate || Date.now() - state.connection.lastUpdate.getTime() <= 5 * 60_000) return;
  state.heatAssessment = { ...state.heatAssessment, riskLevel: 'unavailable', dataQuality: 'unavailable', heatIndexC: null, heatIndexF: null, triggeredRules: [], recommendedActions: [], sensors: { temperature: 'stale', humidity: 'stale' } };
  const active = state.alertsHistory.find(a => a.ruleId === 'nws-heat-index-v1' && a.status === 'active');
  if (active) Object.assign(active, { dataQuality: 'stale', resolutionPending: true, assessment: state.heatAssessment });
  state.activeAlert = active || state.hardwareAlert;
  saveState();
  notify('risk_expired', state.heatAssessment);
}

export function expireStaleTelemetry(now = Date.now()) {
  const status = state.connection.status;
  if (!['connected-waiting', 'receiving', 'invalid-json'].includes(status)) return;
  const lastSeen = state.connection.lastUpdate?.getTime() || state.connection.connectedAt?.getTime();
  if (!lastSeen || now - lastSeen < 10_000) return;
  state.connection.status = 'stale';
  clearConfirmedDeviceProfile('stale');
  const active = state.alertsHistory.find(item => item.ruleId === 'esp32-risk-v1' && item.status === 'active');
  if (active) active.resolutionPending = true;
  notify('connection_stale', state.connection.lastUpdate);
}

export function applyProfileCommandResult(result) {
  const confirmed = result.success && result.patientProfile && Number.isFinite(result.patientTemperatureThreshold);
  state.connection.profileCommandStatus = {
    status: confirmed ? 'confirmed' : 'failed',
    message: result.message || (confirmed ? `ESP32 confirmed ${result.patientProfile}.` : 'ESP32 did not confirm the profile change.'),
  };
  if (confirmed) {
    state.current.patientProfile = result.patientProfile;
    state.current.patientTemperatureThreshold = result.patientTemperatureThreshold;
    state.current.humanCalculation = { profile: result.patientProfile, temperatureThreshold: result.patientTemperatureThreshold, temperatureValid: null, thresholdCrossed: null, measuredTemperature: null, temperatureDifference: null, temperatureUnit: null };
    state.current.patientProfiles = state.current.patientProfiles.map(profile => ({ ...profile, active: profile.name === result.patientProfile }));
  }
  notify('profile_command_result', state.connection.profileCommandStatus);
  return confirmed;
}

export function clearConfirmedDeviceProfile(status = 'disconnected') {
  state.current.patientProfile = 'UNKNOWN';
  state.current.patientTemperatureThreshold = null;
  state.current.patientProfiles = [];
  state.current.humanCalculation = { profile: 'UNKNOWN', temperatureThreshold: null, temperatureValid: null, thresholdCrossed: null, measuredTemperature: null, temperatureDifference: null, temperatureUnit: null };
  state.connection.profileCommandStatus = { status, message: 'Waiting for current ESP32 profile confirmation.' };
}

/**
 * Acknowledge an active or logged alert
 */
export function acknowledgeAlert(alertId, operator = 'Operator') {
  const now = new Date();
  let found = false;

  if (state.activeAlert && (state.activeAlert.id === alertId || !alertId)) {
    state.activeAlert.acknowledged = true;
    state.activeAlert.ackTime = now.toISOString();
    found = true;
  }
  state.alertsHistory = state.alertsHistory.map(a => {
    if (a.id === alertId || (!alertId && !a.acknowledged)) {
      found = true;
      return {
        ...a,
        acknowledged: true,
        ackTime: now.toISOString(),
        audit: operator,
      };
    }
    return a;
  });
  if (state.hardwareAlert?.id === alertId || (!alertId && state.hardwareAlert)) Object.assign(state.hardwareAlert, { acknowledged: true, ackTime: now.toISOString() });

  saveState();
  notify('alert_acknowledged', { alertId, operator, ackTime: now });
  return found;
}

/**
 * Filter history based on time window
 */
export function getFilteredHistory(windowType = 'all') {
  const now = Date.now();
  let cutoff = 0;

  if (windowType === '15m') {
    cutoff = now - 15 * 60 * 1000;
  } else if (windowType === '1h') {
    cutoff = now - 60 * 60 * 1000;
  } else if (windowType === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    cutoff = today.getTime();
  }

  if (cutoff === 0) return [...state.history];
  return state.history.filter(h => new Date(h.timestamp).getTime() >= cutoff);
}

/**
 * Calculate statistical aggregates for a metric from stored real readings
 */
export function calculateStats(metricKey, entries) {
  if (!entries || entries.length === 0) {
    return { min: '--', max: '--', avg: '--', count: 0, latest: '--' };
  }

  const values = entries
    .map(e => e[metricKey])
    .filter(v => typeof v === 'number' && !isNaN(v));

  if (values.length === 0) {
    return { min: '--', max: '--', avg: '--', count: 0, latest: '--' };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const latest = values[values.length - 1];

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    latest: Number(latest.toFixed(2)),
    count: values.length,
  };
}

export function clearHistory() {
  state.history = [];
  state.alertsHistory = [];
  localStorage.removeItem(STORAGE_KEY_HISTORY);
  localStorage.removeItem(STORAGE_KEY_ALERTS);
  notify('history_cleared');
}
