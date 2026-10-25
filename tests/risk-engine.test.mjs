import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEnvironment } from '../js/risk-engine.mjs';

const now = () => new Date().toISOString();

test('NWS heat index categories, formula inputs and vulnerable groups share hazard category', () => {
  const normal = assessEnvironment({ temperature: 20, humidity: 50, timestamp: now() });
  assert.equal(normal.riskLevel, 'normal');
  assert.deepEqual(normal.triggeredRules, []);
  const risk = assessEnvironment({ temperature: 33, humidity: 70, timestamp: now() });
  assert.ok(Number.isFinite(risk.heatIndexC));
  assert.equal(risk.riskLevel, 'danger');
  for (const group of ['general','older_adults','pregnant','under_five','asthma']) assert.equal(risk.personalized[group].riskLevel, risk.riskLevel);
  assert.equal(risk.personalized.older_adults.additionalPrecautions, true);
});

test('NWS heat-index regression returns Celsius from Fahrenheit inputs for the reported ESP32 example', () => {
  const result = assessEnvironment({ temperature: 34.2, humidity: 75.5, timestamp: now() });
  assert.ok(Math.abs(result.heatIndexC - 50.436) < 0.01);
  assert.ok(Math.abs(result.heatIndexF - 122.785) < 0.01);
});

test('invalid, stale and unsupported measurements are unavailable and MQ-135 is never AQI', () => {
  const invalid = assessEnvironment({ temperature: Infinity, humidity: 101, gasAnalog: 1268, timestamp: now() });
  assert.equal(invalid.riskLevel, 'unavailable');
  assert.equal(invalid.heatIndexC, null);
  assert.equal(invalid.gasSensor.rawAdc, 1268);
  assert.equal(invalid.gasSensor.aqi, null);
  assert.equal(invalid.gasSensor.concentration, null);
  assert.equal(assessEnvironment({ temperature: 38, humidity: 60, timestamp: '2000-01-01' }).dataQuality, 'unavailable');
  assert.equal(assessEnvironment({ temperature: 25, humidity: 50 }).dataQuality, 'unavailable');
});

test('one stable alert is updated, acknowledged, resolved and retained on later readings', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { state, recordReading, acknowledgeAlert } = await import('../js/state.js');
  state.settings.profiles = ['older_adults','pregnant'];
  const reading = (temperature, humidity) => recordReading({ temperature, humidity, gasAnalog: 1268, timestamp: new Date() });
  reading(33, 70);
  const alert = state.alertsHistory.find(a => a.ruleId === 'nws-heat-index-v1');
  assert.ok(alert);
  const id = alert.id;
  acknowledgeAlert(id);
  reading(34, 70);
  assert.equal(state.alertsHistory.filter(a => a.ruleId === 'nws-heat-index-v1').length, 1);
  assert.equal(alert.id, id);
  assert.equal(alert.acknowledged, true);
  assert.deepEqual(alert.relevantGroups, ['older_adults','pregnant']);
  reading(NaN, 70);
  assert.equal(state.alertsHistory.find(a => a.id === id).status, 'active');
  assert.equal(state.alertsHistory.find(a => a.id === id).resolutionPending, true);
  reading(20, 50);
  assert.equal(state.alertsHistory.find(a => a.id === id).status, 'resolved');
  reading(33, 70);
  assert.equal(state.alertsHistory.filter(a => a.ruleId === 'nws-heat-index-v1').length, 2);
});
