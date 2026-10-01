/**
 * EcoGuard IoT Environmental Monitoring System
 * Web Serial API Manager
 *
 * STRICT REQUIREMENT:
 * Direct connection to physical ESP32 at 115200 baud via Web Serial API.
 * No intermediate synthetic data layer.
 * Developer simulation is strictly disabled by default.
 */

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
    this.keepReading = false;
    this.isConnected = false;
    this.isSimulated = false;
    this.hasReceivedFirstData = false;
    this.simInterval = null;
  }

  isSupported() {
    return 'serial' in navigator;
  }

  /**
   * Request user to pick the ESP32 USB serial port and open connection at 115200 baud
   */
  async connect(baudRate = 115200) {
    if (!this.isSupported()) {
      const err = new Error('Web Serial API is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      this.callbacks.onError(err);
      this.callbacks.onStatusChange('error');
      throw err;
    }

    try {
      this.callbacks.onStatusChange('connecting');
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: parseInt(baudRate, 10) || 115200 });

      this.isConnected = true;
      this.isSimulated = false;
      this.keepReading = true;
      this.hasReceivedFirstData = false;

      // Status: Connected to port, waiting for real ESP32 frames
      this.callbacks.onStatusChange('connected-waiting');
      this.callbacks.onConnect({
        baudRate: 115200,
        isSimulated: false,
      });

      this.readLoop();
      return true;
    } catch (err) {
      this.isConnected = false;
      this.isSimulated = false;

      if (err.name === 'NotFoundError') {
        // User cancelled port picker dialog
        this.callbacks.onStatusChange('disconnected');
        return false;
      }

      let errorMsg = err.message || err.toString();
      if (err.name === 'NetworkError' || errorMsg.includes('Failed to open')) {
        errorMsg = 'Failed to open serial port. Please ensure Arduino IDE Serial Monitor is closed before connecting.';
      }

      const customError = new Error(errorMsg);
      this.callbacks.onError(customError);
      this.callbacks.onStatusChange('error');
      throw customError;
    }
  }

  /**
   * Continuous stream read loop
   */
  async readLoop() {
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(err => {
      console.warn('Stream pipe warning:', err);
    });
    const reader = textDecoder.readable.getReader();
    this.reader = reader;

    try {
      while (this.keepReading) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          if (!this.hasReceivedFirstData) {
            this.hasReceivedFirstData = true;
            this.callbacks.onStatusChange('connected');
          }
          this.parser.feed(value);
        }
      }
    } catch (error) {
      console.warn('Serial stream read error:', error);
      this.callbacks.onError(error);
      this.callbacks.onStatusChange('error');
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {}
      await this.disconnect();
    }
  }

  async disconnect() {
    this.keepReading = false;
    this.stopSimulation();

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (e) {}
      this.reader = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (e) {}
      this.port = null;
    }

    this.isConnected = false;
    this.isSimulated = false;
    this.hasReceivedFirstData = false;
    this.callbacks.onDisconnect();
    this.callbacks.onStatusChange('disconnected');
    this.parser.reset();
  }

  /**
   * DEVELOPER SIMULATION MODE (OFFLINE TESTING ONLY)
   * Must NEVER be enabled by default.
   */
  startSimulation(baudRate = 115200) {
    if (this.isConnected) {
      this.disconnect();
    }

    this.isSimulated = true;
    this.isConnected = true;
    this.hasReceivedFirstData = true;
    this.callbacks.onStatusChange('connected');
    this.callbacks.onConnect({
      baudRate: baudRate,
      isSimulated: true,
    });

    let cycle = 0;
    this.simInterval = setInterval(() => {
      cycle++;
      let output = '================================\n';
      output += '   SENSOR COMBINED TEST\n';
      output += '================================\n\n';

      output += '--- DHT22 ---\n';
      output += 'Temperature: 34.20 C\n';
      output += 'Humidity: 73.10 %\n\n';

      output += '--- MQ-135 ---\n';
      output += 'Gas Analog Value: 592\n\n';

      output += '--- GPS ---\n';
      output += 'GPS: NO FIX\n';
      output += 'Satellites: 0\n\n';

      output += 'BUZZER: ON - HIGH TEMPERATURE\n\n';
      output += '================================\n';

      this.parser.feed(output);
    }, 2000);
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulated = false;
  }
}
