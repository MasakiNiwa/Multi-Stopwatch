import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, start, stop, reset, elapsed, format, validate, MAX_MS } from '../public/src/model.js';
import { load, save } from '../public/src/storage.js';
test('pause/resume accumulates only running intervals and repeated start is idempotent', () => {
 let t = start(createTimer('a'), 1000); t = start(t, 1500);
 t = stop(t, 6000); assert.equal(elapsed(t, 12000), 5000);
 t = start(t, 12000); assert.equal(elapsed(t, 14000), 7000);
 assert.deepEqual(reset(t), createTimer('a'));
});
test('persisted running timer includes closed time without tick callbacks', () => {
 let raw; const storage = { getItem: () => raw ?? null, setItem: (_, value) => raw = value };
 assert.deepEqual(load(storage), { version: 1, timers: [] });
 save(storage, { version: 1, timers: [start(createTimer('a'), 1000)] });
 assert.equal(elapsed(load(storage).timers[0], 86401000), 86400000);
 assert.equal(format(86400000), '24:00:00');
});
test('clock rollback cannot create negative elapsed; display has bounded elapsed', () => {
 assert.equal(elapsed(start(createTimer('a'), 1000), 500), 0);
 assert.equal(elapsed(start(createTimer('a'), 1000), MAX_MS * 2), MAX_MS);
});
test('independent timers remain independent', () => {
 const a = start(createTimer('a'), 1000), b = start(createTimer('b'), 3000);
 assert.equal(elapsed(stop(a, 5000), 10000), 4000);
 assert.equal(elapsed(b, 10000), 7000);
});
test('reject corrupt, duplicate, future-schema and unbounded data', () => {
 for (const state of [null, {version:2,timers:[]}, {version:1,timers:[createTimer('a'),createTimer('a')]}, ...[NaN,Infinity,-1,MAX_MS+1].map(n=>({version:1,timers:[{...createTimer('a'),elapsedMs:n}]}))]) assert.throws(()=>validate(state));
 assert.throws(()=>load({ getItem:()=>'{broken' }));
});
test('storage write failures propagate rather than claim success', () => {
 assert.throws(()=>save({setItem(){throw Error('quota');}}, {version:1,timers:[]}));
});
