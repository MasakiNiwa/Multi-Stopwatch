import { validate } from './model.js';
export const KEY = 'multi-stopwatch:state:v1';
export function load(storage) {
  const raw = storage.getItem(KEY);
  return raw === null ? { version: 1, timers: [] } : validate(JSON.parse(raw));
}
export function save(storage, state) {
  storage.setItem(KEY, JSON.stringify(validate(state)));
}
