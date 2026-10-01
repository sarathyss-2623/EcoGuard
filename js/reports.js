/**
 * EcoGuard IoT Environmental Monitoring System
 * Reports Engine & CSV Export
 *
 * STRICT REQUIREMENT:
 * Reports and exports must contain ONLY real readings recorded from physical ESP32.
 * Never invent, extrapolate, or export fake numbers.
 */

import { calculateStats } from './state.js';

export class ReportsEngine {
  /**
   * Generate an RFC 4180 compliant CSV file from stored history records
   */
  static exportToCSV(records, reportType = 'complete') {
    if (!records || records.length === 0) {
      alert('No recorded telemetry data available to export.');
      return;
    }

    let headers = [];
    let rows = [];

    if (reportType === 'temperature') {
      headers = ['Timestamp', 'Date_Time', 'Temperature_C', 'Buzzer_State', 'Alert_Active'];
      rows = records.map(r => [
        r.timestamp,
        r.displayTime,
        r.temperature !== null ? r.temperature.toFixed(2) : 'NO_DATA',
        r.buzzerState || 'OFF',
        r.alertActive ? 'TRUE' : 'FALSE'
      ]);
    } else if (reportType === 'humidity') {
      headers = ['Timestamp', 'Date_Time', 'Humidity_Percent'];
      rows = records.map(r => [
        r.timestamp,
        r.displayTime,
        r.humidity !== null ? r.humidity.toFixed(2) : 'NO_DATA'
      ]);
    } else if (reportType === 'mq135') {
      headers = ['Timestamp', 'Date_Time', 'MQ135_Analog_Value_ADC'];
      rows = records.map(r => [
        r.timestamp,
        r.displayTime,
        r.gasAnalog !== null ? r.gasAnalog : 'NO_DATA'
      ]);
    } else if (reportType === 'gps') {
      headers = ['Timestamp', 'Date_Time', 'GPS_Fix', 'Latitude', 'Longitude', 'Satellites'];
      rows = records.map(r => [
        r.timestamp,
        r.displayTime,
        r.gpsFix ? 'FIX' : 'NO_FIX',
        r.latitude !== null ? r.latitude.toFixed(6) : 'NO_FIX',
        r.longitude !== null ? r.longitude.toFixed(6) : 'NO_FIX',
        r.satellites !== null ? r.satellites : 0
      ]);
    } else {
      // Complete Telemetry Log
      headers = [
        'Timestamp',
        'Date_Time',
        'Temperature_C',
        'Humidity_Percent',
        'MQ135_Analog_ADC',
        'GPS_Status',
        'Latitude',
        'Longitude',
        'Satellites',
        'Hardware_Buzzer_State',
        'Alert_State'
      ];
      rows = records.map(r => [
        r.timestamp,
        r.displayTime,
        r.temperature !== null ? r.temperature.toFixed(2) : 'NO_DATA',
        r.humidity !== null ? r.humidity.toFixed(2) : 'NO_DATA',
        r.gasAnalog !== null ? r.gasAnalog : 'NO_DATA',
        r.gpsFix ? 'VALID_FIX' : 'NO_FIX',
        r.latitude !== null ? r.latitude.toFixed(6) : 'NO_FIX',
        r.longitude !== null ? r.longitude.toFixed(6) : 'NO_FIX',
        r.satellites !== null ? r.satellites : 0,
        r.buzzerState || 'OFF',
        r.alertActive ? 'ACTIVE' : 'INACTIVE'
      ]);
    }

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    // Trigger browser file download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `ecoguard_real_${reportType}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Calculate high-level summary cards for the Reports view
   */
  static generateSummary(records, alerts) {
    if (!records || records.length === 0) {
      return {
        temp: { min: '--', max: '--', avg: '--' },
        hum: { min: '--', max: '--', avg: '--' },
        gas: { min: '--', max: '--', avg: '--' },
        readingCount: 0,
        alertCount: alerts ? alerts.length : 0,
        buzzerActiveCount: 0,
        gpsFixPercentage: '0.0',
      };
    }

    const tempStats = calculateStats('temperature', records);
    const humStats = calculateStats('humidity', records);
    const gasStats = calculateStats('gasAnalog', records);
    const activeGpsCount = records.filter(r => r.gpsFix).length;
    const buzzerActiveCount = records.filter(r => r.buzzerState === 'ACTIVE').length;

    return {
      temp: tempStats,
      hum: humStats,
      gas: gasStats,
      readingCount: records.length,
      alertCount: alerts ? alerts.length : 0,
      buzzerActiveCount: buzzerActiveCount,
      gpsFixPercentage: records.length > 0 ? ((activeGpsCount / records.length) * 100).toFixed(1) : '0.0',
    };
  }
}
