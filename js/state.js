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
const MAX_HISTORY_POINTS = 1000;

export const state = {
  connection: {
    status: 'disconnected', // 'connected' | 'disconnected' | 'connecting' | 'connected-waiting' | 'error'
    baudRate: 115200,
    portName: null,
    lastUpdate: null,
    lastUpdateString: null,
    isSimulated: false,
  },
  current: {
    temperature: null,
    humidity: null,
    dhtError: false,
    gasAnalog: null,
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
  activeAlert: null, // Only created when ESP32 reports "BUZZER: ON - HIGH TEMPERATURE"
  history: [],
  alertsHistory: [],
  settings: {
    tempThreshold: 34.0, // Hardware setpoint reference on ESP32
    displayUnit: 'C',
    maxHistoryBuffer: 500,
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

  // 1. DHT22 Processing
  if (reading.dhtError === true) {
    state.current.dhtError = true;
    state.current.temperature = null;
    state.current.humidity = null;
  } else {
    state.current.dhtError = false;
    if (typeof reading.temperature === 'number') {
      state.current.temperature = reading.temperature;
    }
    if (typeof reading.humidity === 'number') {
      state.current.humidity = reading.humidity;
    }
  }

  // 2. MQ-135 Processing (Strict raw ADC value only)
  if (typeof reading.gasAnalog === 'number') {
    state.current.gasAnalog = reading.gasAnalog;
  }

  // 3. GPS Processing
  if (reading.gps) {
    state.current.gps.hasFix = reading.gps.hasFix;
    state.current.gps.satellites = reading.gps.satellites !== null ? reading.gps.satellites : 0;
    state.current.gps.latitude = reading.gps.latitude;
    state.current.gps.longitude = reading.gps.longitude;
    if (reading.gps.hasFix) {
      state.current.gps.lastFixTime = timestamp;
    }
  }

  // 4. Hardware Buzzer Alert Logic:
  // MANDATORY: Driven EXCLUSIVELY by ESP32 buzzer message!
  // "BUZZER: ON - HIGH TEMPERATURE" creates active alert
  // "BUZZER: OFF" clears active alert
  // Temperature alone NEVER triggers an alert!
  if (reading.buzzerState) {
    const isBuzzerOn = reading.buzzerState === 'ON';
    state.current.buzzer.state = isBuzzerOn ? 'ACTIVE' : 'OFF';
    state.current.buzzer.reason = isBuzzerOn ? (reading.buzzerReason || 'HIGH TEMPERATURE') : '';

    if (isBuzzerOn) {
      if (!state.activeAlert) {
        state.activeAlert = {
          id: 'alert-' + timestamp.getTime(),
          timestamp: timestamp.toISOString(),
          displayTime: timeString,
          temperature: state.current.temperature,
          threshold: 34.0,
          acknowledged: false,
          ackTime: null,
          event: 'HIGH TEMPERATURE',
        };

        state.alertsHistory.unshift({
          id: state.activeAlert.id,
          timestamp: timestamp.toISOString(),
          displayTime: timeString,
          event: 'HIGH TEMPERATURE',
          hardwareBuzzer: 'ACTIVE',
          acknowledged: false,
          ackTime: null,
          audit: 'Unacknowledged',
          temperature: state.current.temperature,
        });

        notify('alert_triggered', state.activeAlert);
      }
    } else {
      // Buzzer is OFF: Clear active hardware alert immediately
      if (state.activeAlert) {
        const clearedAlert = state.activeAlert;
        state.activeAlert = null;
        notify('alert_cleared', clearedAlert);
      }
    }
  }

  // Append real entry to history buffer
  const historyEntry = {
    id: 'h-' + timestamp.getTime(),
    timestamp: timestamp.toISOString(),
    displayTime: timeString,
    temperature: state.current.dhtError ? null : state.current.temperature,
    humidity: state.current.dhtError ? null : state.current.humidity,
    dhtError: state.current.dhtError,
    gasAnalog: state.current.gasAnalog,
    gpsFix: state.current.gps.hasFix,
    latitude: state.current.gps.latitude,
    longitude: state.current.gps.longitude,
    satellites: state.current.gps.satellites,
    buzzerState: state.current.buzzer.state,
    alertActive: state.current.buzzer.state === 'ACTIVE',
  };

  state.history.push(historyEntry);
  if (state.history.length > MAX_HISTORY_POINTS) {
    state.history.shift();
  }

  saveState();
  notify('reading_recorded', historyEntry);
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
