import test from 'node:test';
import assert from 'node:assert/strict';
import { humanTemperatureStatus } from '../js/human-status.mjs';

test('human danger status follows only the ESP32 human calculation and telemetry freshness', () => {
  const state = { dhtError: false, riskLevel: 'CRITICAL', humanCalculation: { temperatureValid: true, thresholdCrossed: false } };
  assert.equal(humanTemperatureStatus(state, true), 'SAFE');
  state.riskLevel = 'NORMAL';
  state.humanCalculation.thresholdCrossed = true;
  assert.equal(humanTemperatureStatus(state, true), 'DANGER');
  state.humanCalculation.temperatureValid = false;
  assert.equal(humanTemperatureStatus(state, true), 'UNKNOWN');
  state.humanCalculation.temperatureValid = true;
  assert.equal(humanTemperatureStatus(state, false), 'STALE');
  state.dhtError = true;
  assert.equal(humanTemperatureStatus(state, true), 'UNKNOWN');
});
