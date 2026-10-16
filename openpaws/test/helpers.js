'use strict';
// Builds an in-memory OpenPaws backend (no Electron) for tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store.js');
const { Pets } = require('../src/main/pets.js');
const { Scheduler } = require('../src/main/services/scheduler.js');
const { Weather } = require('../src/main/services/weather.js');
const { Wellness } = require('../src/main/services/wellness.js');
const { Calendar } = require('../src/main/services/calendar.js');
const { Memory } = require('../src/main/brain/memory.js');
const { Brain } = require('../src/main/brain/index.js');

class FakeSecrets { constructor() { this.v = {}; } get(k) { return this.v[k] || ''; } set(k, v) { this.v[k] = v; } has(k) { return !!this.v[k]; } }

function backend(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpaws-test-'));
  const store = new Store(dir);
  store.save = () => {}; // no disk writes needed
  const secrets = new FakeSecrets();
  const pets = new Pets(store, () => {});
  const memory = new Memory(store);
  const fetchImpl = (opts && opts.fetch) || (async () => { throw new Error('no network in tests'); });
  const scheduler = new Scheduler(store, {});
  const weather = new Weather(store, { fetch: fetchImpl });
  const wellness = new Wellness(store, {}, null);
  const calendar = new Calendar(store, {}, { fetch: fetchImpl });
  const services = { scheduler, weather, wellness, calendar, memory, pets, microsoft: null, google: null };
  const brain = new Brain({ store, secrets, memory, pets, services });
  const cat = pets.create({ companion: 0 });
  return { dir, store, secrets, pets, memory, scheduler, weather, wellness, calendar, services, brain, cat };
}

module.exports = { backend, FakeSecrets };
