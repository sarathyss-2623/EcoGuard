import test from 'node:test';
import assert from 'node:assert/strict';
import { ESP32Parser } from '../js/parser.js';

const payload = {
  device_id: 'ecoguard-node-01', transport: 'USB_SERIAL', timestamp_ms: 5012,
  temperature: 31.2, humidity: 84.9, heat_index: 43.42179, dht_valid: true,
  mq135_raw: 768, gps_fix: false, latitude: 0, longitude: 0, satellites: 0,
  patient_profile: 'GENERAL', patient_temperature_threshold: 34, risk_level: 'CRITICAL',
  risk_reason: 'Extreme heat', buzzer_on: true,
  thresholds: { temperature_caution: 30, temperature_high: 35, temperature_extreme: 40, humidity_low: 30, humidity_high: 70, humidity_extreme: 85, heat_index_caution: 27, heat_index_high: 32, heat_index_extreme: 39 },
  patient_profiles: [{ name: 'GENERAL', temperature_threshold: 34 }, { name: 'ASTHMA', temperature_threshold: 34 }],
};

test('parses chunked newline JSON snapshots and ignores unknown fields', () => {
  const readings = [];
  const parser = new ESP32Parser(reading => readings.push(reading));
  const first = JSON.stringify(payload);
  const second = JSON.stringify({ ...payload, temperature: 32, risk_level: 'HIGH', extra_firmware_field: true });
  parser.feed(`  ${first.slice(0, 70)}`);
  parser.feed(`${first.slice(70)}\r\n\n${second}\n`);
  assert.equal(readings.length, 2);
  assert.equal(readings[0].temperature, 31.2);
  assert.equal(readings[0].heatIndex, 43.42179);
  assert.equal(readings[0].gasAnalog, 768);
  assert.equal(readings[0].gps.hasFix, false);
  assert.equal(readings[0].gps.latitude, null);
  assert.equal(readings[0].riskLevel, 'CRITICAL');
  assert.equal(readings[1].riskLevel, 'HIGH');
});

test('reports malformed JSON and handles missing/null sensor values without inventing data', () => {
  const readings = [], invalid = [];
  const parser = new ESP32Parser(reading => readings.push(reading), () => {}, (line, error) => invalid.push([line, error]));
  parser.feed('{broken json}\n');
  parser.feed(`${JSON.stringify({ dht_valid: false, temperature: null, humidity: null, mq135_raw: null, gps_fix: false, risk_level: 'NORMAL' })}\n`);
  assert.equal(invalid.length, 1);
  assert.equal(readings[0].temperature, null);
  assert.equal(readings[0].humidity, null);
  assert.equal(readings[0].gasAnalog, null);
  assert.equal(readings[0].riskLevel, 'UNKNOWN');
  assert.match(readings[0].riskReason, /not confirmed/);
  assert.equal(readings[0].gps.hasFix, false);
});

test('accepts only the documented firmware risk levels', () => {
  const readings = [];
  const parser = new ESP32Parser(reading => readings.push(reading));
  for (const level of ['NORMAL','CAUTION','HIGH','CRITICAL','UNKNOWN','OTHER']) {
    parser.feed(`${JSON.stringify({ risk_level: level, dht_valid: true })}\n`);
  }
  assert.deepEqual(readings.map(reading => reading.riskLevel), ['NORMAL','CAUTION','HIGH','CRITICAL','UNKNOWN','UNKNOWN']);
});

test('parses firmware human calculations and all available profile thresholds', () => {
  const readings = [];
  const parser = new ESP32Parser(reading => readings.push(reading));
  parser.feed(`${JSON.stringify({
    message_type: 'telemetry', dht_valid: true, temperature: 34.6, humidity: 75.5, heat_index: 50.4,
    patient_profile: 'GENERAL', patient_temperature_threshold: 34,
    human_calculation: { profile: 'GENERAL', temperature_threshold: 34, temperature_valid: true, threshold_crossed: true, measured_temperature: 34.6, temperature_difference: 0.6, temperature_unit: 'C' },
    patient_profiles: ['GENERAL:34', 'OLDER_ADULT:32', 'PREGNANT:32', 'CHILD_UNDER_FIVE:32', 'ASTHMA:34'].map(item => { const [name, threshold] = item.split(':'); return { name, temperature_threshold: Number(threshold), active: name === 'GENERAL' }; }),
  })}\n`);
  const reading = readings[0];
  assert.equal(reading.patientProfile, 'GENERAL');
  assert.deepEqual(reading.humanCalculation, { profile: 'GENERAL', temperatureThreshold: 34, temperatureValid: true, thresholdCrossed: true, measuredTemperature: 34.6, temperatureDifference: 0.6, temperatureUnit: 'C' });
  assert.deepEqual(reading.patientProfiles.map(profile => profile.name), ['GENERAL','OLDER_ADULT','PREGNANT','CHILD_UNDER_FIVE','ASTHMA']);
  assert.deepEqual(reading.patientProfiles.map(profile => profile.temperatureThreshold), [34,32,32,32,34]);
  assert.equal(reading.patientProfiles[0].active, true);
});

test('routes command results separately from telemetry', () => {
  const readings = [], results = [];
  const parser = new ESP32Parser(reading => readings.push(reading), () => {}, () => {}, result => results.push(result));
  parser.feed(`${JSON.stringify({ message_type: 'command_result', success: true, message: 'Profile changed', patient_profile: 'OLDER_ADULT', patient_temperature_threshold: 32 })}\n`);
  parser.feed(`${JSON.stringify({ message_type: 'command_result', success: false, message: 'Invalid profile', patient_profile: 'GENERAL', patient_temperature_threshold: 34 })}\n`);
  assert.equal(readings.length, 0);
  assert.deepEqual(results[0], { success: true, message: 'Profile changed', patientProfile: 'OLDER_ADULT', patientTemperatureThreshold: 32 });
  assert.equal(results[1].success, false);
});

test('invalid DHT data makes human calculations and heat index unavailable', () => {
  const readings = [];
  const parser = new ESP32Parser(reading => readings.push(reading));
  parser.feed(`${JSON.stringify({ dht_valid: false, temperature: 34.6, humidity: 75.5, heat_index: 50.4, patient_profile: 'GENERAL', patient_temperature_threshold: 34, human_calculation: { profile: 'GENERAL', temperature_threshold: 34, temperature_valid: true, threshold_crossed: true, measured_temperature: 34.6, temperature_difference: 0.6, temperature_unit: 'C' } })}\n`);
  assert.equal(readings[0].temperature, null);
  assert.equal(readings[0].humidity, null);
  assert.equal(readings[0].heatIndex, null);
  assert.equal(readings[0].patientTemperatureThreshold, 34);
  assert.equal(readings[0].humanCalculation.temperatureThreshold, null);
  assert.equal(readings[0].humanCalculation.measuredTemperature, null);
  assert.equal(readings[0].humanCalculation.temperatureDifference, null);
  assert.equal(readings[0].humanCalculation.thresholdCrossed, null);
});
