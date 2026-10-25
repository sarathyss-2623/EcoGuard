export function humanTemperatureStatus(current, telemetryIsCurrent) {
  if (!telemetryIsCurrent) return 'STALE';
  const calculation = current.humanCalculation;
  if (current.dhtError || calculation?.temperatureValid !== true || typeof calculation.thresholdCrossed !== 'boolean') return 'UNKNOWN';
  return calculation.thresholdCrossed ? 'DANGER' : 'SAFE';
}
