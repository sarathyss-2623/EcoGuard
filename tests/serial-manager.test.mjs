import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialManager } from '../js/serial.js';

test('opens one selected port at 115200, streams chunks, and closes/releases the reader', async () => {
  const reads = [];
  let pendingRead;
  let opens = 0, closes = 0, pickers = 0, released = false, writerReleased = false;
  const writes = [];
  const reader = {
    read: () => new Promise(resolve => { pendingRead = resolve; }),
    cancel: async () => { pendingRead?.({ done: true }); },
    releaseLock: () => { released = true; },
  };
  const port = {
    readable: { getReader: () => reader },
    writable: { getWriter: () => ({ write: async value => writes.push(new TextDecoder().decode(value)), releaseLock: () => { writerReleased = true; } }) },
    open: async options => { opens++; assert.equal(options.baudRate, 115200); },
    close: async () => { closes++; },
    getInfo: () => ({}),
  };
  const serial = {
    requestPort: async () => { pickers++; return port; },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
  const parser = { feed: chunk => reads.push(chunk), reset() {} };
  const manager = new SerialManager(parser);
  assert.equal(await manager.connect(115200), true);
  assert.equal(await manager.connect(115200), false);
  assert.equal(pickers, 1);
  await manager.setProfile('OLDER_ADULT');
  assert.deepEqual(writes, ['{"command":"set_profile","profile":"OLDER_ADULT"}\n']);
  assert.equal(writerReleased, true);
  await assert.rejects(manager.setProfile('NOT_A_PROFILE'), /Unsupported ESP32 patient profile/);
  const encoder = new TextEncoder();
  pendingRead({ value: encoder.encode('{"temperature":31.'), done: false });
  await new Promise(resolve => setImmediate(resolve));
  pendingRead({ value: encoder.encode('2}\n'), done: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reads, ['{"temperature":31.', '2}\n']);
  await manager.disconnect();
  assert.equal(closes, 1);
  assert.equal(released, true);
  assert.equal(manager.isConnected, false);
});
