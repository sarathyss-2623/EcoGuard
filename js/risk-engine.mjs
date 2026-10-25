// NWS Rothfusz heat-index method and NWS heat-index risk bands (°F).
export const HEAT_RULE = {
  id: 'nws-heat-index-v1', hazard: 'heat', requiredInputs: ['temperatureC','humidityPercent'], unit: 'heat index °F / °C',
  methodology: 'NWS Rothfusz regression with humidity adjustments', thresholds: { caution: 80, extremeCaution: 90, danger: 103, extremeDanger: 125 },
  supportedProfiles: ['general','older_adults','pregnant','under_five','asthma'], source: 'https://www.weather.gov/ama/heatindex',
  populationSources: ['https://www.cdc.gov/heat-health/about/','https://www.who.int/europe/news-room/fact-sheets/item/keepcool-in-the-heat'],
  resolution: 'valid heat index below 80°F', limitations: 'Rothfusz method is applied at 80–112°F; local acclimatization, sun, wind, duration and indoor conditions are not represented.',
};

export function assessEnvironment({ temperature, humidity, gasAnalog, timestamp }) {
  const fresh = Number.isFinite(Date.parse(timestamp)) && Date.now() - Date.parse(timestamp) <= 5 * 60_000 && Date.parse(timestamp) <= Date.now() + 60_000;
  const tempValid = Number.isFinite(temperature) && temperature >= -40 && temperature <= 80;
  const humidityValid = Number.isFinite(humidity) && humidity >= 0 && humidity <= 100;
  const methodSupported = !tempValid || temperature * 9 / 5 + 32 < 80 || temperature * 9 / 5 + 32 <= 112;
  const valid = fresh && tempValid && humidityValid && methodSupported;
  let heatIndexC = null;
  let heatIndexF = null;
  if (valid && temperature * 9 / 5 + 32 >= 80) {
    const t = temperature * 9 / 5 + 32, r = humidity;
    heatIndexF = -42.379 + 2.04901523*t + 10.14333127*r - .22475541*t*r - .00683783*t*t - .05481717*r*r + .00122874*t*t*r + .00085282*t*r*r - .00000199*t*t*r*r;
    if (r < 13 && t >= 80 && t <= 112) heatIndexF -= ((13-r)/4)*Math.sqrt((17-Math.abs(t-95))/17);
    if (r > 85 && t >= 80 && t <= 87) heatIndexF += ((r-85)/10)*((87-t)/5);
    heatIndexC = (heatIndexF - 32) * 5 / 9;
  }
  const { caution, extremeCaution, danger, extremeDanger } = HEAT_RULE.thresholds;
  const riskLevel = !valid ? 'unavailable' : heatIndexF === null || heatIndexF < caution ? 'normal' : heatIndexF < extremeCaution ? 'caution' : heatIndexF < danger ? 'extreme-caution' : heatIndexF < extremeDanger ? 'danger' : 'extreme-danger';
  const triggeredRules = ['caution','extreme-caution','danger','extreme-danger'].includes(riskLevel) ? [HEAT_RULE.id] : [];
  const actions = riskLevel === 'normal' || riskLevel === 'unavailable' ? [] : ['Stay cool and hydrated; reduce strenuous activity in heat.'];
  const groups = ['general','older_adults','pregnant','under_five','asthma'];
  const personalized = Object.fromEntries(groups.map(profile => [profile, {
    profile, relevantHazards: ['heat'], riskLevel, additionalPrecautions: triggeredRules.length > 0,
    explanation: triggeredRules.length ? profile === 'general' ? 'Heat-index precautions apply to everyone.' : 'This group may need additional precautions during hot conditions.' : 'No additional heat precaution indicated by this assessment.',
    recommendedActions: triggeredRules.length ? profile === 'general' ? actions : [...actions, 'Check in regularly and seek a cool place if feeling unwell.'] : [],
    ruleId: HEAT_RULE.id, sources: HEAT_RULE.populationSources, dataQuality: valid ? 'valid' : 'unavailable',
  }]));
  return { hazard: 'heat', temperatureC: tempValid ? temperature : null, humidityPercent: humidityValid ? humidity : null, heatIndexC, heatIndexF, thresholdC: (caution - 32) * 5 / 9, riskLevel, dataQuality: !fresh ? 'unavailable' : !tempValid || !humidityValid ? 'invalid' : !methodSupported ? 'unsupported' : 'valid', sensors: { temperature: tempValid ? 'valid' : 'unavailable', humidity: humidityValid ? 'valid' : 'unavailable' }, triggeredRules, recommendedActions: actions, personalized, gasSensor: { rawAdc: Number.isInteger(gasAnalog) && gasAnalog >= 0 && gasAnalog <= 4095 ? gasAnalog : null, dataQuality: Number.isInteger(gasAnalog) && gasAnalog >= 0 && gasAnalog <= 4095 ? 'uncalibrated-indication' : 'unavailable', concentration: null, aqi: null }, timestamp };
}
