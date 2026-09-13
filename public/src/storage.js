import { emptyState, migrate, validate } from './model.js';
// The key names the record, not its schema: the version inside the value is what migrates.
export const KEY = 'multi-stopwatch:state:v1';
// Reads any supported schema and hands back the current one. A newer or broken value still throws,
// so the app falls back to read-only instead of overwriting records it cannot understand.
export function readState(text) {
  return validate(migrate(JSON.parse(text)));
}
export function load(storage) {
  const raw = storage.getItem(KEY);
  return raw === null ? emptyState() : readState(raw);
}
export function save(storage, state) {
  storage.setItem(KEY, JSON.stringify(validate(state)));
}

// UI preferences live under their own key so the stopwatch records keep their own schema and migration.
export const PREFS_KEY = 'multi-stopwatch:prefs:v1';
export const THEMES = ['system', 'light', 'dark'];
export const DEFAULT_PREFS = { version: 1, theme: 'system' };
export function validatePrefs(prefs) {
  if (!prefs || prefs.version !== 1 || !THEMES.includes(prefs.theme)) throw Error('対応していない設定形式です');
  return prefs;
}
// Preferences are conveniences, not records: an unreadable value falls back instead of blocking the app.
export function loadPrefs(storage) {
  try {
    const raw = storage.getItem(PREFS_KEY);
    return raw === null ? { ...DEFAULT_PREFS } : validatePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
export function savePrefs(storage, prefs) {
  storage.setItem(PREFS_KEY, JSON.stringify(validatePrefs(prefs)));
}
