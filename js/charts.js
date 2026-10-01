/**
 * EcoGuard IoT Environmental Monitoring System
 * Technical SVG & Sparkline Telemetry Charts
 * Strictly adhering to Stitch Palette: Venice Blue (#16587B) & Rock Blue (#84B3CE)
 *
 * STRICT REQUIREMENT:
 * Never plots fake, estimated, or synthetic points.
 * Displays clean waiting state when no real data exists.
 */

export class TelemetryCharts {
  /**
   * Render or update a responsive mini sparkline in SVG
   */
  static renderSparkline(svgElement, values, options = {}) {
    if (!svgElement) return;

    const width = options.width || 280;
    const height = options.height || 64;
    svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svgElement.setAttribute('preserveAspectRatio', 'none');

    if (!values || values.length === 0) {
      svgElement.innerHTML = `
        <line x1="0" y1="${(height * 0.5).toFixed(0)}" x2="${width}" y2="${(height * 0.5).toFixed(0)}" stroke="#84B3CE" stroke-dasharray="3 3" stroke-opacity="0.5" />
        <text x="${width / 2}" y="${height / 2 + 3}" font-family="JetBrains Mono" font-size="9" fill="#84B3CE" text-anchor="middle" letter-spacing="0.05em">AWAITING REAL SENSOR DATA</text>
      `;
      return;
    }

    const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (validValues.length === 0) {
      svgElement.innerHTML = `
        <line x1="0" y1="${(height * 0.5).toFixed(0)}" x2="${width}" y2="${(height * 0.5).toFixed(0)}" stroke="#84B3CE" stroke-dasharray="3 3" stroke-opacity="0.5" />
        <text x="${width / 2}" y="${height / 2 + 3}" font-family="JetBrains Mono" font-size="9" fill="#84B3CE" text-anchor="middle" letter-spacing="0.05em">NO NUMERIC DATA</text>
      `;
      return;
    }

    const threshold = options.threshold !== undefined ? options.threshold : null;
    const minVal = options.min !== undefined ? Math.min(options.min, ...validValues) : Math.min(...validValues);
    const maxVal = options.max !== undefined ? Math.max(options.max, ...validValues) : Math.max(...validValues);
    const range = (maxVal - minVal) === 0 ? 1 : (maxVal - minVal);

    // Generate polyline points
    const step = validValues.length > 1 ? width / (validValues.length - 1) : width;
    const points = validValues.map((val, idx) => {
      const x = (idx * step).toFixed(1);
      const normalized = (val - minVal) / range;
      const y = (height - 8 - (normalized * (height - 16))).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    let thresholdLineHtml = '';
    if (threshold !== null && threshold >= minVal && threshold <= maxVal) {
      const normThresh = (threshold - minVal) / range;
      const threshY = (height - 8 - (normThresh * (height - 16))).toFixed(1);
      thresholdLineHtml = `<line x1="0" y1="${threshY}" x2="${width}" y2="${threshY}" stroke="#16587B" stroke-width="1.2" stroke-dasharray="3 3" />`;
    }

    const lastPoint = points.split(' ').pop().split(',');

    svgElement.innerHTML = `
      <!-- Subgrid lines in Rock Blue (#84B3CE) -->
      <line x1="0" y1="${(height * 0.25).toFixed(0)}" x2="${width}" y2="${(height * 0.25).toFixed(0)}" stroke="#84B3CE" stroke-dasharray="2 2" stroke-opacity="0.4" />
      <line x1="0" y1="${(height * 0.75).toFixed(0)}" x2="${width}" y2="${(height * 0.75).toFixed(0)}" stroke="#84B3CE" stroke-dasharray="2 2" stroke-opacity="0.4" />
      ${thresholdLineHtml}
      <!-- Telemetry Signal Trace in Venice Blue (#16587B) -->
      <polyline points="${points}" fill="none" stroke="#16587B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <!-- Active Live Marker Point -->
      <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="3.5" fill="#16587B" />
    `;
  }

  /**
   * Render an expanded technical telemetry chart for History and Sensor Detail views
   */
  static renderExpandedChart(container, dataPoints, metricKey, label, unit, setpoint = null) {
    if (!container) return;

    if (!dataPoints || dataPoints.length === 0) {
      container.innerHTML = `
        <div class="h-64 flex flex-col items-center justify-center border border-[#84B3CE]/40 rounded bg-[#F5EEDD] text-[#34647C]">
          <span class="material-symbols-outlined text-[32px] text-[#84B3CE]">sensors_off</span>
          <span class="font-label-sm text-label-sm uppercase tracking-wider mt-2 font-semibold">No historical data available.</span>
          <span class="font-body-sm text-body-sm text-secondary/70 mt-1">Connect physical ESP32 to record real telemetry.</span>
        </div>
      `;
      return;
    }

    const validEntries = dataPoints.filter(d => typeof d[metricKey] === 'number' && !isNaN(d[metricKey]));
    if (validEntries.length === 0) {
      container.innerHTML = `
        <div class="h-64 flex flex-col items-center justify-center border border-[#84B3CE]/40 rounded bg-[#F5EEDD] text-[#34647C]">
          <span class="material-symbols-outlined text-[32px] text-[#84B3CE]">query_stats</span>
          <span class="font-label-sm text-label-sm uppercase tracking-wider mt-2 font-semibold">No valid numeric records for ${label}</span>
        </div>
      `;
      return;
    }

    const values = validEntries.map(d => d[metricKey]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (setpoint !== null) {
      min = Math.min(min, setpoint - 1);
      max = Math.max(max, setpoint + 1);
    }
    const padding = (max - min) * 0.1 || 1;
    min = min - padding;
    max = max + padding;
    const range = max - min;

    const width = 800;
    const height = 240;
    const leftGutter = 60;
    const bottomGutter = 30;
    const chartW = width - leftGutter - 20;
    const chartH = height - bottomGutter - 20;

    const step = values.length > 1 ? chartW / (values.length - 1) : chartW;
    const points = values.map((val, i) => {
      const x = (leftGutter + i * step).toFixed(1);
      const y = (20 + chartH - ((val - min) / range) * chartH).toFixed(1);
      return `${x},${y}`;
    }).join(' ');

    const ticks = [0, 0.25, 0.5, 0.75, 1];
    const gridLines = ticks.map(t => {
      const y = 20 + chartH - t * chartH;
      const val = (min + t * range).toFixed(1);
      return `
        <line x1="${leftGutter}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="#84B3CE" stroke-opacity="0.3" stroke-dasharray="2 2" />
        <text x="${leftGutter - 8}" y="${y + 4}" font-family="JetBrains Mono" font-size="10" fill="#34647C" text-anchor="end">${val} ${unit}</text>
      `;
    }).join('');

    let setpointSvg = '';
    if (setpoint !== null) {
      const sy = 20 + chartH - ((setpoint - min) / range) * chartH;
      setpointSvg = `
        <line x1="${leftGutter}" y1="${sy}" x2="${width - 20}" y2="${sy}" stroke="#16587B" stroke-width="1.5" stroke-dasharray="4 3" />
        <text x="${width - 24}" y="${sy - 4}" font-family="JetBrains Mono" font-size="10" font-weight="600" fill="#16587B" text-anchor="end">SETPOINT: ${setpoint} ${unit}</text>
      `;
    }

    const firstTime = validEntries[0].displayTime || 'Start';
    const lastTime = validEntries[validEntries.length - 1].displayTime || 'Latest';

    container.innerHTML = `
      <div class="relative w-full overflow-hidden bg-[#F5EEDD] border border-[#84B3CE] rounded p-2">
        <div class="flex justify-between items-center text-[#34647C] font-label-sm text-label-sm px-2 pb-1 border-b border-[#84B3CE]/30">
          <span class="uppercase tracking-wider font-semibold text-[#16587B]">${label} (Real ESP32 Telemetry)</span>
          <span>${values.length} Real Recorded Frames</span>
        </div>
        <svg class="w-full h-56" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          ${gridLines}
          ${setpointSvg}
          <polyline points="${points}" fill="none" stroke="#16587B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="${points.split(' ').pop().split(',')[0]}" cy="${points.split(' ').pop().split(',')[1]}" r="4" fill="#16587B" />
          <text x="${leftGutter}" y="${height - 8}" font-family="JetBrains Mono" font-size="10" fill="#34647C">${firstTime}</text>
          <text x="${width - 20}" y="${height - 8}" font-family="JetBrains Mono" font-size="10" fill="#34647C" text-anchor="end">${lastTime}</text>
        </svg>
      </div>
    `;
  }
}
