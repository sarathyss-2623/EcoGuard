/**
 * EcoGuard IoT Environmental Monitoring System
 * Main Frontend Application Controller
 *
 * STRICT REQUIREMENT:
 * Displays ONLY real sensor values received from physical ESP32 over USB Serial.
 * Absolutely NO fake, mock, simulated, or hardcoded sensor values.
 */

import {
  state,
  initStore,
  subscribe,
  recordReading,
  acknowledgeAlert,
  getFilteredHistory,
  calculateStats,
  clearHistory,
} from './state.js';
import { ESP32Parser } from './parser.js';
import { SerialManager } from './serial.js';
import { TelemetryCharts } from './charts.js';
import { ReportsEngine } from './reports.js';

// Web Audio Context for browser buzzer alerts mirroring physical ESP32
let audioCtx = null;
let isAudioMuted = false;

function playAlertTone() {
  if (isAudioMuted) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    console.warn('Audio play failed:', e);
  }
}

let terminalLineCount = 0;

// --------------------------------------------------------------------------
// Application Initialization
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initStore();

  // Serial Parser Setup: Direct line feed from USB stream
  const parser = new ESP32Parser(
    (reading) => {
      recordReading(reading);
    },
    (rawLine) => {
      appendTerminalLine(rawLine);
    }
  );

  // Serial Manager Setup: Web Serial API on 115200 baud
  const serialManager = new SerialManager(parser, {
    onConnect: (info) => {
      updateConnectionUI(true, info);
    },
    onDisconnect: () => {
      updateConnectionUI(false);
    },
    onError: (err) => {
      console.error('Serial Error:', err);
      appendTerminalLine(`[SERIAL ERROR: ${err.message || err}]`, true);
      updateStatusBadge('error');
    },
    onStatusChange: (status) => {
      updateStatusBadge(status);
    },
  });

  // State Change Listener
  subscribe((event, payload, currentState) => {
    handleStateUpdate(event, payload, currentState);
  });

  // UI Setup
  initNavigation();
  initDashboardActions(serialManager);
  initHistoryView();
  initReportsView();
  initAlertsView();
  initSettingsView(serialManager);
  initModals();

  // Initial UI Render strictly in disconnected / waiting state
  renderDashboard(state);
  renderSparklines();
  renderTimeline(state.alertsHistory);

  // Live Clock
  setInterval(updateLiveClock, 1000);
  updateLiveClock();
});

// --------------------------------------------------------------------------
// Navigation & Tab Switching
// --------------------------------------------------------------------------
function initNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  const views = document.querySelectorAll('.tab-view');

  function switchTab(targetTab) {
    const tabName = targetTab.replace('#', '') || 'dashboard';

    views.forEach(v => {
      if (v.id === `tab-${tabName}`) {
        v.classList.remove('hidden');
      } else {
        v.classList.add('hidden');
      }
    });

    navLinks.forEach(link => {
      if (link.dataset.tab === tabName) {
        link.className = 'nav-link group flex items-center gap-space-sm px-space-md py-space-sm rounded transition-all bg-primary-container text-surface border border-primary-container shadow-none';
      } else {
        link.className = 'nav-link group flex items-center gap-space-sm px-space-md py-space-sm rounded border border-transparent text-secondary hover:border-outline-variant hover:text-primary-container transition-all';
      }
    });

    const subhead = document.getElementById('top-subhead');
    if (subhead) {
      const titles = {
        dashboard: 'ESP32 Telemetry Stream',
        history: 'Telemetry Log & Charts',
        reports: 'Diagnostics & CSV Export',
        sensors: 'Hardware Interface Specs',
        alerts: 'Hardware Buzzer Audit Log',
        settings: 'UART & Simulator Settings',
      };
      subhead.textContent = titles[tabName] || 'ESP32 Telemetry';
    }

    if (tabName === 'history') {
      renderHistoryView();
    } else if (tabName === 'reports') {
      renderReportsView();
    } else if (tabName === 'alerts') {
      renderAlertsTable();
    }
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('href');
      history.pushState(null, '', target);
      switchTab(target);
    });
  });

  window.addEventListener('popstate', () => {
    switchTab(window.location.hash || '#dashboard');
  });

  switchTab(window.location.hash || '#dashboard');
}

// --------------------------------------------------------------------------
// Dashboard & Telemetry Rendering (REAL SENSOR VALUES ONLY)
// --------------------------------------------------------------------------
function renderDashboard(currentState) {
  const c = currentState.current;
  const isConnected = currentState.connection.status === 'connected';
  const isWaiting = currentState.connection.status === 'connected-waiting';
  const hasEverReceived = !!currentState.connection.lastUpdateString;

  // 1. Temperature Card (DHT22)
  const tempEl = document.getElementById('dash-val-temp');
  const tempBadge = document.getElementById('badge-temp-status');
  const tempTrend = document.getElementById('dash-trend-temp');

  if (c.dhtError) {
    if (tempEl) tempEl.textContent = 'ERROR';
    if (tempBadge) {
      tempBadge.textContent = 'DHT22 SENSOR ERROR';
      tempBadge.className = 'px-space-xs py-0.5 bg-red-700 text-surface font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold';
    }
    if (tempTrend) tempTrend.textContent = 'Sensor Fault (GPIO 4)';
  } else if (typeof c.temperature === 'number') {
    if (tempEl) tempEl.textContent = c.temperature.toFixed(2);
    const isBuzzerActive = c.buzzer.state === 'ACTIVE';
    if (tempBadge) {
      tempBadge.textContent = isBuzzerActive ? 'HIGH (BUZZER ACTIVE)' : 'Nominal';
      tempBadge.className = isBuzzerActive
        ? 'px-space-xs py-0.5 bg-primary text-surface font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold'
        : 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/10';
    }
    if (tempTrend) {
      tempTrend.textContent = isBuzzerActive ? 'Exceeds 34.0°C Setpoint' : 'Nominal Range';
    }
  } else {
    if (tempEl) tempEl.textContent = '--';
    if (tempBadge) {
      tempBadge.textContent = isWaiting ? 'WAITING FOR DATA' : (hasEverReceived && !isConnected ? 'LAST RECEIVED VALUE' : 'WAITING FOR DATA');
      tempBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/10';
    }
    if (tempTrend) tempTrend.textContent = 'Awaiting Telemetry';
  }

  // 2. Humidity Card (DHT22)
  const humEl = document.getElementById('dash-val-hum');
  const humBadge = document.getElementById('badge-hum-status');
  const humTrend = document.getElementById('dash-trend-hum');

  if (c.dhtError) {
    if (humEl) humEl.textContent = 'ERROR';
    if (humBadge) {
      humBadge.textContent = 'DHT22 SENSOR ERROR';
      humBadge.className = 'px-space-xs py-0.5 bg-red-700 text-surface font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold';
    }
    if (humTrend) humTrend.textContent = 'Sensor Fault (GPIO 4)';
  } else if (typeof c.humidity === 'number') {
    if (humEl) humEl.textContent = c.humidity.toFixed(2);
    if (humBadge) {
      humBadge.textContent = 'Normal';
      humBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/10';
    }
    if (humTrend) humTrend.textContent = 'Steady Hygrometry';
  } else {
    if (humEl) humEl.textContent = '--';
    if (humBadge) {
      humBadge.textContent = isWaiting ? 'WAITING FOR DATA' : (hasEverReceived && !isConnected ? 'LAST RECEIVED VALUE' : 'WAITING FOR DATA');
      humBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/10';
    }
    if (humTrend) humTrend.textContent = 'Awaiting Telemetry';
  }

  // 3. MQ-135 Card (STRICT RAW ANALOG ADC ONLY - NEVER INVENT PPM / AQI)
  const gasEl = document.getElementById('dash-val-gas');
  const gasBadge = document.getElementById('badge-gas-status');

  if (typeof c.gasAnalog === 'number') {
    if (gasEl) gasEl.textContent = c.gasAnalog;
    if (gasBadge) gasBadge.textContent = `RAW ADC: ${c.gasAnalog}`;
  } else {
    if (gasEl) gasEl.textContent = '--';
    if (gasBadge) {
      gasBadge.textContent = isWaiting ? 'WAITING FOR DATA' : (hasEverReceived && !isConnected ? 'LAST RECEIVED VALUE' : 'RAW ADC STREAM');
    }
  }

  // 4. GPS Location Card (NEO-6M GPS)
  const gpsFixEl = document.getElementById('dash-val-gps-fix');
  const gpsBadge = document.getElementById('dash-gps-badge');
  const latEl = document.getElementById('dash-val-lat');
  const lngEl = document.getElementById('dash-val-lng');
  const radarText = document.getElementById('dash-gps-radar-text');

  if (c.gps.hasFix === true && c.gps.latitude !== null && c.gps.longitude !== null) {
    if (gpsFixEl) gpsFixEl.textContent = 'FIX ACQUIRED';
    if (gpsBadge) {
      gpsBadge.textContent = 'VALID FIX';
      gpsBadge.className = 'px-space-xs py-0.5 bg-primary text-surface font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold';
    }
    if (latEl) latEl.textContent = c.gps.latitude.toFixed(6);
    if (lngEl) lngEl.textContent = c.gps.longitude.toFixed(6);
    if (radarText) radarText.textContent = `Ephemeris Locked (${c.gps.satellites || 0} Satellites)`;
  } else if (c.gps.hasFix === false) {
    if (gpsFixEl) gpsFixEl.textContent = 'NO FIX';
    if (gpsBadge) {
      gpsBadge.textContent = 'NO FIX';
      gpsBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/20';
    }
    if (latEl) latEl.textContent = 'NO FIX';
    if (lngEl) lngEl.textContent = 'NO FIX';
    if (radarText) radarText.textContent = 'Scanning (GPIO 26 RX / 27 TX Active)...';
  } else {
    if (gpsFixEl) gpsFixEl.textContent = 'WAITING FOR DATA';
    if (gpsBadge) {
      gpsBadge.textContent = isWaiting ? 'WAITING FOR DATA' : (hasEverReceived && !isConnected ? 'LAST RECEIVED VALUE' : 'WAITING FOR DATA');
      gpsBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/20';
    }
    if (latEl) latEl.textContent = '--';
    if (lngEl) lngEl.textContent = '--';
    if (radarText) radarText.textContent = 'Awaiting GPS data...';
  }

  // 5. Satellite Count Card
  const satsCountEl = document.getElementById('dash-val-sats-count');
  const satsBadge = document.getElementById('dash-sats-badge');
  const satsSub = document.getElementById('dash-val-gps-sats');

  if (c.gps.satellites !== null) {
    if (satsCountEl) satsCountEl.textContent = c.gps.satellites;
    if (satsSub) satsSub.textContent = `${c.gps.satellites} connected`;
    if (satsBadge) {
      satsBadge.textContent = c.gps.satellites > 0 ? `${c.gps.satellites} SATS LOCKED` : '0 SATELLITES';
      satsBadge.className = c.gps.satellites > 0
        ? 'px-space-xs py-0.5 bg-primary text-surface font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold'
        : 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/20';
    }
  } else {
    if (satsCountEl) satsCountEl.textContent = '--';
    if (satsSub) satsSub.textContent = '--';
    if (satsBadge) {
      satsBadge.textContent = isWaiting ? 'WAITING FOR DATA' : (hasEverReceived && !isConnected ? 'LAST RECEIVED VALUE' : 'WAITING FOR DATA');
      satsBadge.className = 'px-space-xs py-0.5 border border-primary text-primary font-label-sm text-label-sm tracking-wider uppercase rounded font-semibold bg-brand-rock/20';
    }
  }

  // 6. Hardware Buzzer Card (GPIO 25)
  const buzzerStatus = document.getElementById('dash-buzzer-status');
  const buzzerWrap = document.getElementById('dash-buzzer-badge-wrap');
  const buzzerPing = document.getElementById('dash-buzzer-ping');
  const buzzerDesc = document.getElementById('dash-buzzer-desc');

  const isBuzzerActive = c.buzzer.state === 'ACTIVE';
  const isBuzzerOff = c.buzzer.state === 'OFF';

  if (isBuzzerActive) {
    if (buzzerStatus) buzzerStatus.textContent = 'BUZZER ACTIVE';
    if (buzzerWrap) {
      buzzerWrap.className = 'flex items-center gap-1.5 px-space-xs py-0.5 bg-primary text-surface rounded';
    }
    if (buzzerPing) {
      buzzerPing.className = 'w-2 h-2 rounded-full bg-brand-rock animate-ping';
    }
    if (buzzerDesc) {
      buzzerDesc.textContent = 'State Description: High Temperature Detected (GPIO 25 HIGH)';
    }
  } else if (isBuzzerOff) {
    if (buzzerStatus) buzzerStatus.textContent = 'BUZZER OFF';
    if (buzzerWrap) {
      buzzerWrap.className = 'flex items-center gap-1.5 px-space-xs py-0.5 border border-brand-rock text-secondary rounded';
    }
    if (buzzerPing) {
      buzzerPing.className = 'w-2 h-2 rounded-full bg-brand-rock';
    }
    if (buzzerDesc) {
      buzzerDesc.textContent = 'State Description: Standby / Normal Operating Conditions (GPIO 25 LOW)';
    }
  } else {
    if (buzzerStatus) buzzerStatus.textContent = 'OFF / WAITING';
    if (buzzerWrap) {
      buzzerWrap.className = 'flex items-center gap-1.5 px-space-xs py-0.5 border border-brand-rock text-secondary rounded';
    }
    if (buzzerPing) {
      buzzerPing.className = 'w-2 h-2 rounded-full bg-secondary/50';
    }
    if (buzzerDesc) {
      buzzerDesc.textContent = 'State Description: Waiting for ESP32 buzzer stream';
    }
  }

  // Timestamps
  const timeStr = currentState.connection.lastUpdateString || '--:--:--';
  const timeFields = ['update-temp-time', 'update-hum-time', 'update-gas-time', 'update-gps-time', 'update-sats-time', 'update-buzzer-time'];
  timeFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = currentState.connection.lastUpdateString ? `Updated: ${timeStr}` : 'Updated: --:--:--';
    }
  });

  const lastUpdateStat = document.getElementById('stat-last-update');
  if (lastUpdateStat) lastUpdateStat.textContent = timeStr;

  const clockStat = document.getElementById('telemetry-live-clock');
  if (clockStat) clockStat.textContent = timeStr;

  // Online Sensors
  const sensorsStat = document.getElementById('stat-sensors-online');
  if (sensorsStat) {
    if (currentState.connection.lastUpdateString) {
      let activeCount = 0;
      if (!c.dhtError && c.temperature !== null) activeCount++;
      if (c.gasAnalog !== null) activeCount++;
      if (c.gps.hasFix !== null) activeCount++;
      sensorsStat.textContent = `${activeCount}/3 Reporting`;
    } else {
      sensorsStat.textContent = '--';
    }
  }

  // Ambient Status Pill
  const ambEl = document.getElementById('stat-ambient-status');
  if (ambEl) {
    if (isBuzzerActive) {
      ambEl.textContent = 'HIGH TEMPERATURE';
    } else if (currentState.connection.lastUpdateString) {
      ambEl.textContent = 'Nominal';
    } else {
      ambEl.textContent = 'Waiting for data...';
    }
  }

  // Disconnected / Last Received label banner
  const subheadEl = document.getElementById('dash-subtitle');
  if (subheadEl) {
    if (currentState.connection.status === 'disconnected') {
      if (currentState.connection.lastUpdateString) {
        subheadEl.textContent = `ESP32 DISCONNECTED • Showing LAST RECEIVED VALUE (Received at ${currentState.connection.lastUpdateString})`;
      } else {
        subheadEl.textContent = 'Waiting for real sensor data...';
      }
    } else if (currentState.connection.status === 'connected-waiting') {
      subheadEl.textContent = 'Connected to ESP32 port (115200 baud) • Waiting for real sensor data...';
    } else if (currentState.connection.status === 'connected') {
      subheadEl.textContent = 'ESP32 Connected (115200 baud) • Streaming live physical telemetry';
    }
  }

  // CRITICAL ALERT LOGIC: Large Alert Banner Visibility
  // Shown EXCLUSIVELY when activeAlert exists (BUZZER: ON - HIGH TEMPERATURE)
  updateAlertBanner(currentState);
}

function updateAlertBanner(currentState) {
  const alertBanner = document.getElementById('alert-banner');
  if (!alertBanner) return;

  // The alert panel is visible ONLY when an active alert exists
  if (currentState.activeAlert) {
    alertBanner.classList.remove('hidden');

    const tempEl = document.getElementById('alert-capsule-temp');
    if (tempEl) {
      tempEl.textContent = typeof currentState.current.temperature === 'number'
        ? `${currentState.current.temperature.toFixed(2)} °C`
        : '--.-- °C';
    }
    const timeEl = document.getElementById('alert-capsule-time');
    if (timeEl) {
      timeEl.textContent = currentState.activeAlert.displayTime || '--:--:--';
    }

    const ackBtn = document.getElementById('btn-alert-ack');
    const ackText = document.getElementById('btn-alert-ack-text');
    if (currentState.activeAlert.acknowledged) {
      if (ackBtn) {
        ackBtn.className = 'border border-primary bg-brand-rock/20 text-primary px-space-md py-space-xs rounded font-label-md text-label-md tracking-wider uppercase font-semibold flex items-center gap-space-xs';
      }
      if (ackText) ackText.textContent = 'Acknowledged';
    } else {
      if (ackBtn) {
        ackBtn.className = 'bg-primary hover:bg-brand-rock text-surface hover:text-primary px-space-md py-space-xs rounded font-label-md text-label-md tracking-wider uppercase transition-all flex items-center gap-space-xs font-semibold';
      }
      if (ackText) ackText.textContent = 'Acknowledge Alert';
      playAlertTone();
    }
  } else {
    alertBanner.classList.add('hidden');
  }
}

function renderSparklines() {
  const history = state.history;
  const tempSvg = document.getElementById('sparkline-temp');
  const humSvg = document.getElementById('sparkline-hum');
  const gasSvg = document.getElementById('sparkline-gas');

  if (history.length === 0) {
    TelemetryCharts.renderSparkline(tempSvg, []);
    TelemetryCharts.renderSparkline(humSvg, []);
    TelemetryCharts.renderSparkline(gasSvg, []);
    return;
  }

  const tempVals = history.map(h => h.temperature).filter(v => typeof v === 'number');
  const humVals = history.map(h => h.humidity).filter(v => typeof v === 'number');
  const gasVals = history.map(h => h.gasAnalog).filter(v => typeof v === 'number');

  TelemetryCharts.renderSparkline(tempSvg, tempVals, {
    min: 20.0,
    max: 40.0,
    threshold: 34.0,
  });

  TelemetryCharts.renderSparkline(humSvg, humVals, {
    min: 30.0,
    max: 90.0,
  });

  TelemetryCharts.renderSparkline(gasSvg, gasVals, {
    min: 0,
    max: 1024,
  });
}

function renderTimeline(alerts) {
  const tbody = document.getElementById('timeline-table-body');
  if (!tbody) return;

  if (!alerts || alerts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-space-md text-center text-secondary">
          No hardware buzzer events recorded yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = alerts.slice(0, 8).map(a => {
    const isAck = a.acknowledged;
    const isBuzzerActive = a.hardwareBuzzer === 'ACTIVE';

    return `
      <tr class="${isBuzzerActive && !isAck ? 'bg-brand-rock/15 hover:bg-brand-rock/25' : 'hover:bg-brand-rock/10'} transition-colors">
        <td class="py-space-sm px-space-sm font-semibold tabular-nums font-mono">${a.displayTime}</td>
        <td class="py-space-sm px-space-sm">
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${isBuzzerActive ? 'bg-primary' : 'bg-secondary'}"></span>
            <span class="${isBuzzerActive ? 'font-bold' : ''}">${a.event}</span>
          </div>
        </td>
        <td class="py-space-sm px-space-sm">
          <span class="px-space-xs py-0.5 ${isBuzzerActive ? 'bg-primary text-surface font-bold' : 'border border-brand-rock text-secondary'} font-label-sm text-label-sm rounded uppercase tracking-wider">
            ${a.hardwareBuzzer}
          </span>
        </td>
        <td class="py-space-sm px-space-sm">
          <span class="font-semibold uppercase tracking-wider font-label-sm text-label-sm ${isAck ? 'text-secondary' : 'text-primary border border-primary px-1.5 py-0.5 rounded bg-surface'}">
            ${isAck ? 'Acknowledged' : 'Unacknowledged'}
          </span>
        </td>
        <td class="py-space-sm px-space-sm text-right">
          ${!isAck ? `
            <button class="btn-table-ack font-label-sm text-label-sm uppercase text-primary hover:underline font-semibold" data-id="${a.id}">
              [ Acknowledge ]
            </button>
          ` : `
            <span class="font-label-sm text-label-sm text-secondary">${a.audit || 'Operator'}</span>
          `}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.btn-table-ack').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      acknowledgeAlert(id, 'Operator 01');
      renderTimeline(state.alertsHistory);
      updateAlertBanner(state);
    });
  });
}

// --------------------------------------------------------------------------
// Actions & Handlers
// --------------------------------------------------------------------------
function initDashboardActions(serialManager) {
  const btnHeaderSerial = document.getElementById('btn-header-serial');
  if (btnHeaderSerial) {
    btnHeaderSerial.addEventListener('click', async () => {
      if (serialManager.isConnected) {
        await serialManager.disconnect();
      } else {
        try {
          await serialManager.connect(115200);
        } catch (err) {
          if (err.name !== 'NotFoundError') {
            alert(`Serial Connection Error: ${err.message}`);
          }
        }
      }
    });
  }

  const btnAlertAck = document.getElementById('btn-alert-ack');
  if (btnAlertAck) {
    btnAlertAck.addEventListener('click', () => {
      acknowledgeAlert(state.activeAlert ? state.activeAlert.id : null, 'Operator 01');
      updateAlertBanner(state);
      renderTimeline(state.alertsHistory);
    });
  }

  const btnAlertSilence = document.getElementById('btn-alert-silence');
  if (btnAlertSilence) {
    btnAlertSilence.addEventListener('click', () => {
      isAudioMuted = !isAudioMuted;
      btnAlertSilence.textContent = isAudioMuted ? 'Unmute Browser Audio' : 'Mute Browser Audio';
      alert('Browser alert audio state updated.\n\nNote: The physical ESP32 GPIO25 buzzer is hardware-controlled by the microcontroller firmware and will continue sounding until ambient temperature drops below 34.0°C.');
    });
  }

  const btnBuzzerMute = document.getElementById('btn-buzzer-mute');
  if (btnBuzzerMute) {
    btnBuzzerMute.addEventListener('click', () => {
      isAudioMuted = true;
      alert('Browser acoustic notifications muted.\n(Hardware GPIO25 buzzer remains under firmware control).');
    });
  }

  const btnBuzzerTest = document.getElementById('btn-buzzer-test');
  if (btnBuzzerTest) {
    btnBuzzerTest.addEventListener('click', () => {
      playAlertTone();
    });
  }

  const btnExportTimeline = document.getElementById('btn-export-timeline-log');
  if (btnExportTimeline) {
    btnExportTimeline.addEventListener('click', () => {
      ReportsEngine.exportToCSV(state.history, 'complete');
    });
  }

  // Dashboard Live Raw Terminal Clear
  const btnDashClear = document.getElementById('btn-dash-clear-terminal');
  if (btnDashClear) {
    btnDashClear.addEventListener('click', clearBothTerminals);
  }
}

// --------------------------------------------------------------------------
// History View
// --------------------------------------------------------------------------
let currentHistoryMetric = 'temperature';
let currentHistoryWindow = 'all';

function initHistoryView() {
  document.querySelectorAll('.hist-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-metric-btn').forEach(b => {
        b.className = 'hist-metric-btn px-3 py-1 rounded font-label-sm text-label-sm uppercase font-semibold border border-brand-rock text-primary hover:bg-brand-rock/10';
      });
      btn.className = 'hist-metric-btn px-3 py-1 rounded font-label-sm text-label-sm uppercase font-semibold bg-primary text-surface';
      currentHistoryMetric = btn.dataset.metric;
      renderHistoryView();
    });
  });

  document.querySelectorAll('.hist-time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-time-btn').forEach(b => {
        b.className = 'hist-time-btn px-2.5 py-1 rounded font-label-sm text-label-sm uppercase border border-brand-rock text-primary hover:bg-brand-rock/10';
      });
      btn.className = 'hist-time-btn px-2.5 py-1 rounded font-label-sm text-label-sm uppercase bg-primary text-surface';
      currentHistoryWindow = btn.dataset.window;
      renderHistoryView();
    });
  });
}

function renderHistoryView() {
  const filtered = getFilteredHistory(currentHistoryWindow);
  const container = document.getElementById('history-chart-container');
  const countEl = document.getElementById('hist-total-count');
  if (countEl) countEl.textContent = `${filtered.length} Stored Records`;

  const meta = {
    temperature: { label: 'DHT22 Temperature', unit: '°C', setpoint: 34.0 },
    humidity: { label: 'DHT22 Relative Humidity', unit: '%', setpoint: null },
    gasAnalog: { label: 'MQ-135 Analog ADC', unit: 'ADC', setpoint: null },
  };

  const currentMeta = meta[currentHistoryMetric] || meta.temperature;
  TelemetryCharts.renderExpandedChart(
    container,
    filtered,
    currentHistoryMetric,
    currentMeta.label,
    currentMeta.unit,
    currentMeta.setpoint
  );

  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-space-md text-center text-secondary">No historical data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice().reverse().slice(0, 100).map(r => `
    <tr class="hover:bg-brand-rock/10 transition-colors">
      <td class="py-space-xs px-space-sm font-mono">${r.displayTime}</td>
      <td class="py-space-xs px-space-sm font-semibold">${r.temperature !== null ? r.temperature.toFixed(2) + ' °C' : (r.dhtError ? 'SENSOR ERROR' : '--')}</td>
      <td class="py-space-xs px-space-sm">${r.humidity !== null ? r.humidity.toFixed(2) + ' %' : (r.dhtError ? 'SENSOR ERROR' : '--')}</td>
      <td class="py-space-xs px-space-sm font-mono">${r.gasAnalog !== null ? r.gasAnalog : '--'}</td>
      <td class="py-space-xs px-space-sm">${r.gpsFix ? 'FIX (' + (r.satellites || 0) + ' Sats)' : 'NO FIX'}</td>
      <td class="py-space-xs px-space-sm">
        <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${r.buzzerState === 'ACTIVE' ? 'bg-primary text-surface' : 'border border-brand-rock text-secondary'}">
          ${r.buzzerState || 'OFF'}
        </span>
      </td>
    </tr>
  `).join('');
}

// --------------------------------------------------------------------------
// Reports View
// --------------------------------------------------------------------------
function initReportsView() {
  const btnExport = document.getElementById('btn-report-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const type = document.getElementById('report-select-type').value;
      const windowType = document.getElementById('report-select-window').value;
      const records = getFilteredHistory(windowType);
      ReportsEngine.exportToCSV(records, type);
    });
  }

  const btnPrint = document.getElementById('btn-report-print');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      window.print();
    });
  }

  document.getElementById('report-select-type')?.addEventListener('change', renderReportsView);
  document.getElementById('report-select-window')?.addEventListener('change', renderReportsView);
}

function renderReportsView() {
  const windowType = document.getElementById('report-select-window')?.value || 'all';
  const records = getFilteredHistory(windowType);
  const summary = ReportsEngine.generateSummary(records, state.alertsHistory);

  document.getElementById('rep-stat-readings').textContent = summary.readingCount;
  document.getElementById('rep-stat-temp-range').textContent = summary.temp.min !== '--' ? `${summary.temp.min} / ${summary.temp.max} °C` : '-- / --';
  document.getElementById('rep-stat-temp-avg').textContent = summary.temp.avg !== '--' ? `${summary.temp.avg} °C` : '-- °C';
  document.getElementById('rep-stat-hum-avg').textContent = summary.hum.avg !== '--' ? `${summary.hum.avg} %` : '-- %';
  document.getElementById('rep-stat-gas-avg').textContent = summary.gas.avg;
  document.getElementById('rep-stat-alerts').textContent = summary.buzzerActiveCount;

  const tbody = document.getElementById('report-table-body');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-space-md text-center text-secondary">No real telemetry data recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.slice(-50).reverse().map(r => `
    <tr class="hover:bg-brand-rock/10 transition-colors font-body-sm text-body-sm">
      <td class="py-space-xs px-space-sm font-mono">${r.displayTime}</td>
      <td class="py-space-xs px-space-sm font-semibold">${r.temperature !== null ? r.temperature.toFixed(2) + ' °C' : (r.dhtError ? 'ERROR' : '--')}</td>
      <td class="py-space-xs px-space-sm">${r.humidity !== null ? r.humidity.toFixed(2) + ' %' : (r.dhtError ? 'ERROR' : '--')}</td>
      <td class="py-space-xs px-space-sm font-mono">${r.gasAnalog !== null ? r.gasAnalog : '--'}</td>
      <td class="py-space-xs px-space-sm">${r.gpsFix ? 'FIX (' + (r.satellites || 0) + ' Sats)' : 'NO FIX'}</td>
      <td class="py-space-xs px-space-sm font-bold ${r.buzzerState === 'ACTIVE' ? 'text-primary' : 'text-secondary'}">
        ${r.buzzerState || 'OFF'}
      </td>
    </tr>
  `).join('');
}

// --------------------------------------------------------------------------
// Alerts View
// --------------------------------------------------------------------------
let currentAlertFilter = 'all';

function initAlertsView() {
  document.querySelectorAll('.alert-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.alert-filter-btn').forEach(b => {
        b.className = 'alert-filter-btn px-3 py-1 rounded font-label-sm text-label-sm uppercase border border-brand-rock text-primary hover:bg-brand-rock/10 font-semibold';
      });
      btn.className = 'alert-filter-btn px-3 py-1 rounded font-label-sm text-label-sm uppercase bg-primary text-surface font-semibold';
      currentAlertFilter = btn.dataset.filter;
      renderAlertsTable();
    });
  });
}

function renderAlertsTable() {
  const tbody = document.getElementById('alerts-page-table-body');
  if (!tbody) return;

  let alerts = state.alertsHistory;
  if (currentAlertFilter === 'unacknowledged') {
    alerts = alerts.filter(a => !a.acknowledged);
  } else if (currentAlertFilter === 'acknowledged') {
    alerts = alerts.filter(a => a.acknowledged);
  }

  if (alerts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-space-md text-center text-secondary">No alerts recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = alerts.map(a => `
    <tr class="hover:bg-brand-rock/10 transition-colors font-body-sm text-body-sm">
      <td class="py-space-sm px-space-sm font-mono font-semibold">${a.displayTime}</td>
      <td class="py-space-sm px-space-sm font-semibold">${a.event}</td>
      <td class="py-space-sm px-space-sm">
        <span class="px-2 py-0.5 rounded font-label-sm text-label-sm uppercase font-bold ${a.hardwareBuzzer === 'ACTIVE' ? 'bg-primary text-surface' : 'border border-brand-rock text-secondary'}">
          ${a.hardwareBuzzer}
        </span>
      </td>
      <td class="py-space-sm px-space-sm font-mono">${a.temperature ? a.temperature.toFixed(2) + ' °C' : '34.0+ °C'}</td>
      <td class="py-space-sm px-space-sm">
        <span class="font-semibold font-label-sm text-label-sm uppercase ${a.acknowledged ? 'text-secondary' : 'text-primary border border-primary px-1.5 py-0.5 rounded'}">
          ${a.acknowledged ? 'Acknowledged (' + (a.audit || 'Staff') + ')' : 'Pending Review'}
        </span>
      </td>
      <td class="py-space-sm px-space-sm text-right">
        ${!a.acknowledged ? `
          <button class="btn-page-ack bg-primary text-surface hover:bg-brand-rock hover:text-primary px-3 py-1 rounded font-label-sm text-label-sm uppercase font-semibold" data-id="${a.id}">
            Acknowledge
          </button>
        ` : `
          <span class="text-secondary font-label-sm text-label-sm uppercase">Verified</span>
        `}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-page-ack').forEach(btn => {
    btn.addEventListener('click', () => {
      acknowledgeAlert(btn.dataset.id, 'Operator 01');
      renderAlertsTable();
      renderTimeline(state.alertsHistory);
      updateAlertBanner(state);
    });
  });
}

// --------------------------------------------------------------------------
// Settings View & Developer Simulation
// --------------------------------------------------------------------------
function initSettingsView(serialManager) {
  document.getElementById('btn-settings-connect')?.addEventListener('click', async () => {
    try {
      await serialManager.connect(115200);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        alert(`Serial Error: ${err.message}`);
      }
    }
  });

  document.getElementById('btn-settings-disconnect')?.addEventListener('click', async () => {
    await serialManager.disconnect();
  });

  // DEVELOPER SIMULATION MODE CONTROLS
  const simEnable = document.getElementById('sim-toggle-enable');
  const simLabel = document.getElementById('sim-status-label');
  const simBanner = document.getElementById('sim-active-banner');

  if (simEnable) {
    simEnable.checked = false; // MUST NEVER be enabled by default
    simEnable.addEventListener('change', () => {
      if (simEnable.checked) {
        serialManager.startSimulation(115200);
        if (simLabel) simLabel.textContent = 'Simulator: Active (DEVELOPER MODE)';
        if (simBanner) simBanner.classList.remove('hidden');
      } else {
        serialManager.stopSimulation();
        serialManager.disconnect();
        if (simLabel) simLabel.textContent = 'Simulator: Inactive';
        if (simBanner) simBanner.classList.add('hidden');
      }
    });
  }

  // Clear Storage
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Clear all stored real telemetry history and local records?')) {
      clearHistory();
      renderSparklines();
      renderTimeline([]);
      renderHistoryView();
      renderReportsView();
    }
  });

  // Clear Terminal (Settings view button)
  document.getElementById('btn-clear-terminal')?.addEventListener('click', clearBothTerminals);
}

function clearBothTerminals() {
  terminalLineCount = 0;
  const dashTerm = document.getElementById('dash-raw-terminal');
  const setTerm = document.getElementById('raw-terminal');
  const lineCountEl = document.getElementById('dash-term-linecount');

  const emptyMsg = '<div class="text-secondary/70">[Terminal cleared.]</div>';
  if (dashTerm) dashTerm.innerHTML = emptyMsg;
  if (setTerm) setTerm.innerHTML = emptyMsg;
  if (lineCountEl) lineCountEl.textContent = '0 Lines';
}

function appendTerminalLine(line, isError = false) {
  terminalLineCount++;
  const dashTerm = document.getElementById('dash-raw-terminal');
  const setTerm = document.getElementById('raw-terminal');
  const lineCountEl = document.getElementById('dash-term-linecount');

  if (lineCountEl) lineCountEl.textContent = `${terminalLineCount} Lines`;

  [dashTerm, setTerm].forEach(term => {
    if (!term) return;
    const div = document.createElement('div');
    div.className = isError ? 'text-red-700 font-bold' : 'text-primary whitespace-pre font-mono';
    div.textContent = line;
    term.appendChild(div);

    if (term.childNodes.length > 400) {
      term.removeChild(term.firstChild);
    }
    term.scrollTop = term.scrollHeight;
  });
}

// --------------------------------------------------------------------------
// Sensor Details Modal
// --------------------------------------------------------------------------
function initModals() {
  const modal = document.getElementById('sensor-modal');
  const btnClose = document.getElementById('btn-close-modal');
  const btnDone = document.getElementById('btn-modal-done');

  function closeModal() {
    modal.classList.add('hidden');
  }

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnDone) btnDone.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.querySelectorAll('.sensor-card, .open-modal-btn').forEach(el => {
    el.addEventListener('click', () => {
      const sensorKey = el.dataset.sensor;
      if (sensorKey) openSensorModal(sensorKey);
    });
  });

  document.getElementById('btn-alert-details')?.addEventListener('click', () => {
    openSensorModal('buzzer');
  });
}

function openSensorModal(sensorKey) {
  const modal = document.getElementById('sensor-modal');
  if (!modal) return;

  const titleEl = document.getElementById('modal-title');
  const valCurr = document.getElementById('modal-val-curr');
  const valAvg = document.getElementById('modal-val-avg');
  const valMin = document.getElementById('modal-val-min');
  const valMax = document.getElementById('modal-val-max');
  const specText = document.getElementById('modal-spec-text');
  const chartBox = document.getElementById('modal-chart-box');
  const tableBody = document.getElementById('modal-recent-table');

  const history = state.history;
  const current = state.current;

  let metricKey = 'temperature';
  let unit = '°C';
  let setpoint = null;

  if (sensorKey === 'temperature') {
    if (titleEl) titleEl.textContent = 'DHT22 Temperature Telemetry';
    const stats = calculateStats('temperature', history);
    if (valCurr) valCurr.textContent = current.dhtError ? 'SENSOR ERROR' : (current.temperature !== null ? `${current.temperature.toFixed(2)} °C` : '--');
    if (valAvg) valAvg.textContent = stats.avg !== '--' ? `${stats.avg} °C` : '--';
    if (valMin) valMin.textContent = stats.min !== '--' ? `${stats.min} °C` : '--';
    if (valMax) valMax.textContent = stats.max !== '--' ? `${stats.max} °C` : '--';
    metricKey = 'temperature';
    unit = '°C';
    setpoint = 34.0;
    if (specText) {
      specText.innerHTML = `
        <p><strong>Hardware Pin:</strong> ESP32 GPIO 4</p>
        <p><strong>Protocol:</strong> Single-wire digital bitstream (DHT.h)</p>
        <p><strong>Hardware Threshold:</strong> 34.0 °C (ESP32 Firmware Buzzer Trigger)</p>
      `;
    }
  } else if (sensorKey === 'humidity') {
    if (titleEl) titleEl.textContent = 'DHT22 Relative Humidity Telemetry';
    const stats = calculateStats('humidity', history);
    if (valCurr) valCurr.textContent = current.dhtError ? 'SENSOR ERROR' : (current.humidity !== null ? `${current.humidity.toFixed(2)} %` : '--');
    if (valAvg) valAvg.textContent = stats.avg !== '--' ? `${stats.avg} %` : '--';
    if (valMin) valMin.textContent = stats.min !== '--' ? `${stats.min} %` : '--';
    if (valMax) valMax.textContent = stats.max !== '--' ? `${stats.max} %` : '--';
    metricKey = 'humidity';
    unit = '%';
    setpoint = null;
    if (specText) {
      specText.innerHTML = `
        <p><strong>Hardware Pin:</strong> ESP32 GPIO 4</p>
        <p><strong>Nominal Range:</strong> 40.0 % - 80.0 %</p>
      `;
    }
  } else if (sensorKey === 'mq135') {
    if (titleEl) titleEl.textContent = 'MQ-135 Gas Analog ADC Stream';
    const stats = calculateStats('gasAnalog', history);
    if (valCurr) valCurr.textContent = current.gasAnalog !== null ? current.gasAnalog : '--';
    if (valAvg) valAvg.textContent = stats.avg;
    if (valMin) valMin.textContent = stats.min;
    if (valMax) valMax.textContent = stats.max;
    metricKey = 'gasAnalog';
    unit = 'ADC';
    setpoint = null;
    if (specText) {
      specText.innerHTML = `
        <p><strong>Hardware Pin:</strong> ESP32 GPIO 34 (ADC1_CH6)</p>
        <p><strong>Representation:</strong> Raw 10-Bit ADC Voltage (0 - 4095). Uncalibrated transducer value.</p>
        <p><strong>Notice:</strong> Raw ADC value only. Never converted to PPM or AQI.</p>
      `;
    }
  } else if (sensorKey === 'gps') {
    if (titleEl) titleEl.textContent = 'NEO-6M GPS Receiver Telemetry';
    if (valCurr) valCurr.textContent = current.gps.hasFix ? 'VALID FIX' : (current.gps.hasFix === false ? 'NO FIX' : 'WAITING');
    if (valAvg) valAvg.textContent = current.gps.satellites !== null ? `${current.gps.satellites} Sats` : '--';
    if (valMin) valMin.textContent = current.gps.latitude !== null ? current.gps.latitude.toFixed(6) : (current.gps.hasFix === false ? 'NO FIX' : '--');
    if (valMax) valMax.textContent = current.gps.longitude !== null ? current.gps.longitude.toFixed(6) : (current.gps.hasFix === false ? 'NO FIX' : '--');
    metricKey = 'satellites';
    unit = 'Sats';
    setpoint = null;
    if (specText) {
      specText.innerHTML = `
        <p><strong>Hardware UART:</strong> HardwareSerial GPS(1) on Pins 26 (RX) / 27 (TX)</p>
        <p><strong>Baud Rate:</strong> 9600 Baud (NMEA)</p>
        <p><strong>Satellites Tracked:</strong> ${current.gps.satellites !== null ? current.gps.satellites : '--'}</p>
      `;
    }
  } else if (sensorKey === 'buzzer') {
    if (titleEl) titleEl.textContent = 'Hardware Buzzer & Alarm State';
    if (valCurr) valCurr.textContent = current.buzzer.state;
    if (valAvg) valAvg.textContent = 'GPIO 25';
    if (valMin) valMin.textContent = current.buzzer.reason || 'Normal';
    if (valMax) valMax.textContent = state.activeAlert ? 'ACTIVE' : 'IDLE';
    metricKey = 'temperature';
    unit = '°C';
    setpoint = 34.0;
    if (specText) {
      specText.innerHTML = `
        <p><strong>Hardware Pin:</strong> ESP32 BUZZER_PIN = 25 (Active HIGH)</p>
        <p><strong>Firmware Logic:</strong> if (!isnan(temperature) && temperature > 34) digitalWrite(BUZZER_PIN, HIGH);</p>
        <p><strong>Source of Truth:</strong> ESP32 Serial "BUZZER: ON - HIGH TEMPERATURE" / "BUZZER: OFF"</p>
      `;
    }
  }

  TelemetryCharts.renderExpandedChart(chartBox, history.slice(-20), metricKey, titleEl.textContent, unit, setpoint);

  if (tableBody) {
    if (history.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="p-2 text-center text-secondary">No recorded real telemetry data.</td></tr>`;
    } else {
      tableBody.innerHTML = history.slice(-10).reverse().map(h => `
        <tr>
          <td class="p-1.5 font-mono">${h.displayTime}</td>
          <td class="p-1.5 font-semibold">${h[metricKey] !== null && h[metricKey] !== undefined ? h[metricKey] + ' ' + unit : '--'}</td>
          <td class="p-1.5">${h.buzzerState || 'OFF'}</td>
          <td class="p-1.5 font-semibold ${h.buzzerState === 'ACTIVE' ? 'text-primary' : 'text-secondary'}">
            ${h.buzzerState === 'ACTIVE' ? 'ALERT ACTIVE' : 'NOMINAL'}
          </td>
        </tr>
      `).join('');
    }
  }

  modal.classList.remove('hidden');
}

// --------------------------------------------------------------------------
// UI State Updates
// --------------------------------------------------------------------------
function updateConnectionUI(isConnected, info = {}) {
  const btnHeader = document.getElementById('btn-header-serial');
  const btnHeaderText = document.getElementById('btn-header-serial-text');
  const dashConn = document.getElementById('dash-conn-status');
  const sideConn = document.getElementById('sidebar-conn-text');
  const sideMode = document.getElementById('sidebar-mode');
  const sidePing = document.getElementById('sidebar-ping');
  const sideDot = document.getElementById('sidebar-dot');
  const topModeBadge = document.getElementById('top-mode-badge');

  if (isConnected) {
    if (btnHeader) {
      btnHeader.className = 'border border-primary bg-brand-rock/20 hover:bg-primary text-primary hover:text-surface px-space-md py-1.5 rounded font-label-md text-label-md tracking-wider uppercase transition-all flex items-center gap-1.5 font-semibold';
    }
    if (btnHeaderText) btnHeaderText.textContent = 'Disconnect';

    const desc = info.isSimulated ? 'ESP32: Simulated (115200 baud)' : 'ESP32 CONNECTED (115200 baud)';
    if (dashConn) dashConn.textContent = desc;
    if (sideConn) sideConn.textContent = info.isSimulated ? 'Simulator Active' : 'ESP32 Connected';
    if (sideMode) sideMode.textContent = info.isSimulated ? 'Dev Simulation' : 'USB Serial';
    if (sidePing) sidePing.classList.remove('hidden');
    if (sideDot) sideDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-primary-container';
    if (topModeBadge) {
      topModeBadge.textContent = info.isSimulated ? 'Simulation (Dev)' : 'Live USB Serial';
    }
  } else {
    if (btnHeader) {
      btnHeader.className = 'bg-primary hover:bg-brand-rock text-surface hover:text-primary px-space-md py-1.5 rounded font-label-md text-label-md tracking-wider uppercase transition-all flex items-center gap-1.5 font-semibold border border-primary';
    }
    if (btnHeaderText) btnHeaderText.textContent = 'Connect ESP32';

    if (dashConn) dashConn.textContent = 'ESP32 DISCONNECTED';
    if (sideConn) sideConn.textContent = 'ESP32 DISCONNECTED';
    if (sideMode) sideMode.textContent = 'Standby';
    if (sidePing) sidePing.classList.add('hidden');
    if (sideDot) sideDot.className = 'relative inline-flex rounded-full h-2 w-2 bg-secondary/50';
    if (topModeBadge) topModeBadge.textContent = 'Standby';
  }
}

function updateStatusBadge(status) {
  const badge = document.getElementById('header-status-text');
  const ping = document.getElementById('header-status-ping');
  const pill = document.getElementById('system-status-pill');
  const pillWrap = document.getElementById('system-status-pill-wrap');
  const subhead = document.getElementById('dash-subtitle');
  const monState = document.getElementById('dash-monitoring-state');
  const monStatus = document.getElementById('dash-monitoring-status-text');
  const monDot = document.getElementById('dash-monitoring-dot');

  state.connection.status = status;

  if (status === 'connecting') {
    if (badge) badge.textContent = 'CONNECTING...';
    if (ping) ping.className = 'inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse';
    if (pill) pill.textContent = 'CONNECTING...';
    if (subhead) subhead.textContent = 'Opening USB serial port at 115200 baud...';
    if (monState) monState.textContent = 'Connecting...';
    if (monStatus) monStatus.textContent = 'Opening Serial Port';
    if (monDot) monDot.className = 'w-2 h-2 rounded-full bg-primary animate-ping';
  } else if (status === 'connected-waiting') {
    if (badge) badge.textContent = 'CONNECTED — WAITING FOR DATA';
    if (ping) ping.className = 'inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse';
    if (pill) pill.textContent = 'CONNECTED — WAITING FOR DATA';
    if (pillWrap) pillWrap.className = 'flex items-center gap-space-xs px-space-sm py-1 bg-primary text-surface rounded';
    if (subhead) subhead.textContent = 'Connected to ESP32 port (115200 baud) • Waiting for real sensor data...';
    if (monState) monState.textContent = 'Connected';
    if (monStatus) monStatus.textContent = 'Waiting for Data';
    if (monDot) monDot.className = 'w-2 h-2 rounded-full bg-primary';
  } else if (status === 'connected') {
    if (badge) badge.textContent = 'ESP32 CONNECTED';
    if (ping) ping.className = 'inline-block w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse';
    if (pill) pill.textContent = 'ESP32 CONNECTED';
    if (pillWrap) pillWrap.className = 'flex items-center gap-space-xs px-space-sm py-1 bg-primary text-surface rounded';
    if (subhead) subhead.textContent = 'ESP32 Connected (115200 baud) • Streaming live physical telemetry';
    if (monState) monState.textContent = 'Monitoring Active';
    if (monStatus) monStatus.textContent = 'Real Telemetry Stream';
    if (monDot) monDot.className = 'w-2 h-2 rounded-full bg-primary';
  } else if (status === 'error') {
    if (badge) badge.textContent = 'ESP32 CONNECTION ERROR';
    if (ping) ping.className = 'inline-block w-1.5 h-1.5 rounded-full bg-red-700';
    if (pill) pill.textContent = 'ESP32 CONNECTION ERROR';
    if (pillWrap) pillWrap.className = 'flex items-center gap-space-xs px-space-sm py-1 bg-red-700 text-surface rounded';
    if (subhead) subhead.textContent = 'ESP32 connection error. Ensure Arduino IDE Serial Monitor is closed.';
    if (monState) monState.textContent = 'Connection Error';
    if (monStatus) monStatus.textContent = 'Port Error';
    if (monDot) monDot.className = 'w-2 h-2 rounded-full bg-red-700';
  } else {
    // Disconnected
    if (badge) badge.textContent = 'ESP32 DISCONNECTED';
    if (ping) ping.className = 'inline-block w-1.5 h-1.5 rounded-full bg-secondary';
    if (pill) pill.textContent = 'ESP32 DISCONNECTED';
    if (pillWrap) pillWrap.className = 'flex items-center gap-space-xs px-space-sm py-1 bg-secondary text-surface rounded';
    if (monState) monState.textContent = 'System Standby';
    if (monStatus) monStatus.textContent = 'Disconnected';
    if (monDot) monDot.className = 'w-2 h-2 rounded-full bg-secondary';

    if (state.connection.lastUpdateString) {
      if (subhead) subhead.textContent = `ESP32 DISCONNECTED • Showing LAST RECEIVED VALUE (Received at ${state.connection.lastUpdateString})`;
    } else {
      if (subhead) subhead.textContent = 'Waiting for real sensor data...';
    }
  }
}

function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const headerClock = document.getElementById('header-clock');
  if (headerClock) headerClock.textContent = timeStr;
}

function handleStateUpdate(event, payload, currentState) {
  renderDashboard(currentState);

  if (event === 'reading_recorded') {
    renderSparklines();
  } else if (event === 'alert_triggered' || event === 'alert_acknowledged' || event === 'alert_cleared') {
    renderTimeline(currentState.alertsHistory);
  }
}
