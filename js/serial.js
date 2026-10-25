/** Direct ESP32 Web Serial connection. The user selects the port in the browser picker. */
const VALID_PROFILES = new Set(['GENERAL', 'OLDER_ADULT', 'PREGNANT', 'CHILD_UNDER_FIVE', 'ASTHMA']);

export class SerialManager {
  constructor(parser, callbacks = {}) {
    this.parser = parser;
    this.callbacks = {
      onConnect: callbacks.onConnect || (() => {}),
      onDisconnect: callbacks.onDisconnect || (() => {}),
      onError: callbacks.onError || (() => {}),
      onStatusChange: callbacks.onStatusChange || (() => {}),
    };
    this.port = null;
    this.reader = null;
    this.readTask = null;
    this.keepReading = false;
    this.isConnected = false;
    this.isSimulated = false;
    this.hasReceivedFirstData = false;
    this.simInterval = null;
    this.disconnectStatus = null;
    this.finishPromise = null;
    this.disconnectListener = null;
    this.connecting = false;
    this.writeQueue = Promise.resolve();
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  markReceiving() {
    this.hasReceivedFirstData = true;
    this.callbacks.onStatusChange('receiving');
  }

  setProfile(profile) {
    if (!VALID_PROFILES.has(profile)) return Promise.reject(new Error('Unsupported ESP32 patient profile.'));
    const operation = this.writeQueue.then(async () => {
      if (!this.port || !this.isConnected || this.isSimulated) throw new Error('Connect to the ESP32 before changing its profile.');
      if (!this.port.writable) throw new Error('The selected serial port does not support writing.');
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(new TextEncoder().encode(`${JSON.stringify({ command: 'set_profile', profile })}\n`));
      } finally {
        writer.releaseLock();
      }
      return true;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async connect(baudRate = 115200) {
    if (this.port || this.isConnected || this.isSimulated || this.connecting) return false;
    if (!this.isSupported()) {
      const err = new Error('Web Serial API is unavailable. Use Chrome or Edge over localhost/HTTPS.');
      this.callbacks.onError(err);
      this.callbacks.onStatusChange('error');
      throw err;
    }

    this.connecting = true;
    this.callbacks.onStatusChange('connecting');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number(baudRate) || 115200 });
      this.port = port;
      this.keepReading = true;
      this.isConnected = true;
      this.isSimulated = false;
      this.hasReceivedFirstData = false;
      this.disconnectStatus = null;
      this.finishPromise = null;
      this.disconnectListener = event => {
        if (event.port === this.port) {
          this.disconnectStatus = 'connection-lost';
          this.keepReading = false;
          this.reader?.cancel().catch(() => {});
        }
      };
      navigator.serial.addEventListener('disconnect', this.disconnectListener);
      this.callbacks.onStatusChange('connected-waiting');
      this.callbacks.onConnect({ baudRate: Number(baudRate) || 115200, isSimulated: false, portInfo: port.getInfo?.() || {} });
      this.readTask = this.readLoop();
      return true;
    } catch (err) {
      if (this.port) await this.finishDisconnect('disconnected');
      if (err.name === 'NotFoundError') {
        this.callbacks.onStatusChange('disconnected');
        return false;
      }
      const message = err.name === 'NetworkError' ? 'Could not open the selected serial port. Close any serial monitor using it and retry.' : (err.message || String(err));
      this.callbacks.onError(new Error(message));
      this.callbacks.onStatusChange('error');
      throw new Error(message);
    } finally {
      this.connecting = false;
    }
  }

  async readLoop() {
    const port = this.port;
    const decoder = new TextDecoder();
    try {
      const reader = port.readable.getReader();
      this.reader = reader;
      while (this.keepReading) {
        const { value, done } = await reader.read();
        if (done) {
          if (this.keepReading) this.disconnectStatus = 'connection-lost';
          break;
        }
        if (value) this.parser.feed(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail) this.parser.feed(tail);
    } catch (error) {
      if (this.keepReading) {
        this.callbacks.onError(error);
        this.disconnectStatus = 'connection-lost';
      }
    } finally {
      try { this.reader?.releaseLock(); } catch {}
      this.reader = null;
      await this.finishDisconnect(this.disconnectStatus || 'connection-lost');
    }
  }

  async finishDisconnect(status) {
    if (this.finishPromise) return this.finishPromise;
    this.keepReading = false;
    this.finishPromise = (async () => {
      const port = this.port;
      if (this.disconnectListener && typeof navigator !== 'undefined' && navigator.serial) {
        navigator.serial.removeEventListener('disconnect', this.disconnectListener);
      }
      this.disconnectListener = null;
      if (port) {
        await this.writeQueue;
        try { await port.close(); } catch (error) { console.warn('Serial port close:', error); }
      }
      this.port = null;
      this.isConnected = false;
      this.isSimulated = false;
      this.hasReceivedFirstData = false;
      this.readTask = null;
      this.callbacks.onDisconnect(status);
      this.callbacks.onStatusChange(status);
      this.parser.reset();
    })();
    return this.finishPromise;
  }

  async disconnect() {
    if (this.isSimulated) {
      this.stopSimulation();
      this.isConnected = false;
      this.callbacks.onDisconnect('disconnected');
      this.callbacks.onStatusChange('disconnected');
      this.parser.reset();
      return;
    }
    if (!this.port) return;
    this.disconnectStatus = 'disconnected';
    this.keepReading = false;
    try { await this.reader?.cancel(); } catch {}
    if (this.readTask) await this.readTask;
    else await this.finishDisconnect('disconnected');
  }

  async startSimulation(baudRate = 115200) {
    if (this.isSimulated) return;
    if (this.port) await this.disconnect();
    this.isSimulated = true;
    this.isConnected = true;
    this.hasReceivedFirstData = true;
    this.callbacks.onStatusChange('connected-waiting');
    this.callbacks.onConnect({ baudRate, isSimulated: true });
    this.simInterval = setInterval(() => {
      this.parser.feed('================================\n   SENSOR COMBINED TEST\n================================\n--- DHT22 ---\nTemperature: 34.20 C\nHumidity: 73.10 %\n--- MQ-135 ---\nGas Analog Value: 592\n--- GPS ---\nGPS: NO FIX\nSatellites: 0\nBUZZER: ON - HIGH TEMPERATURE\n================================\n');
    }, 2000);
  }

  stopSimulation() {
    if (this.simInterval) clearInterval(this.simInterval);
    this.simInterval = null;
    this.isSimulated = false;
  }
}
