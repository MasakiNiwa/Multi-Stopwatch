import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, start, stop, reset, setElapsed, elapsed, format, parts, speak, progress, total, running, validate, MAX_MS } from '../public/src/model.js';
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
test('manual correction keeps a running timer running from the corrected value', () => {
 const t = setElapsed(start(createTimer('a'), 1000), 3600000, 5000);
 assert.equal(t.startedAt, 5000);
 assert.equal(elapsed(t, 7000), 3602000);
 const stopped = setElapsed(createTimer('a'), 3600000, 5000);
 assert.equal(stopped.startedAt, null);
 assert.equal(elapsed(stopped, 9e12), 3600000);
});
test('correction is clamped instead of storing values validate would reject', () => {
 assert.equal(setElapsed(createTimer('a'), -1, 0).elapsedMs, 0);
 assert.equal(setElapsed(createTimer('a'), MAX_MS * 2, 0).elapsedMs, MAX_MS);
 assert.doesNotThrow(() => validate({ version: 1, timers: [setElapsed(createTimer('a'), MAX_MS * 2, 0)] }));
});
test('display keeps hours unwrapped and reads out in Japanese', () => {
 assert.deepEqual(parts(3723000), { h: '01', m: '02', s: '03' });
 assert.equal(format(36000000000), '10000:00:00');
 assert.equal(speak(3723000), '1時間2分3秒');
 assert.equal(parts(-1).s, '00');
});
test('summary adds every timer including the running part', () => {
 const timers = [start(createTimer('a'), 1000), createTimer('b'), stop(start(createTimer('c'), 0), 2000)];
 assert.equal(total(timers, 4000), 3000 + 0 + 2000);
 assert.equal(running(timers), 1);
 assert.equal(progress(1000, 4000), 0.25);
 assert.equal(progress(9000, 4000), 1);
 assert.equal(progress(9000, 0), 0);
});
