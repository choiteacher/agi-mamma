// 잠금 해제 기억, 실패 지연, 키패드 선호를 localStorage에 둔다.
// 비밀번호 자체는 어디에도 저장하지 않는다. 저장소를 쓸 수 없어도(사생활 보호 모드 등) 화면은 동작해야 한다.

export const REMEMBER_DAYS = 30;
export const MAX_DELAY_SECONDS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_UNLOCK = 'agi-mamma.gate.unlock';
const KEY_FAIL = 'agi-mamma.gate.fail';
const KEY_NUMERIC = 'agi-mamma.gate.numeric';

const defaultStore = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const readJson = (store, key) => {
  try {
    const raw = store && store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (store, key, value) => {
  try {
    if (store) store.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패는 무시한다(다음 방문 때 다시 입력하면 된다).
  }
};

const remove = (store, key) => {
  try {
    if (store) store.removeItem(key);
  } catch {
    // 무시
  }
};

// 비밀번호를 바꾸면(gate.json의 salt가 바뀌면) 기존 기억은 무효가 되도록 salt 앞부분을 표시로 남긴다.
const gateTag = (gate) => gate.salt.slice(0, 8);

export function rememberUnlock(gate, now = Date.now(), store = defaultStore()) {
  writeJson(store, KEY_UNLOCK, { until: now + REMEMBER_DAYS * DAY_MS, tag: gateTag(gate) });
}

export function isRemembered(gate, now = Date.now(), store = defaultStore()) {
  const saved = readJson(store, KEY_UNLOCK);
  if (!saved || typeof saved.until !== 'number' || saved.tag !== gateTag(gate)) return false;
  // 만료 전이어야 하고, 비정상적으로 먼 미래 값(직접 조작 등)은 받아들이지 않는다.
  return saved.until > now && saved.until <= now + REMEMBER_DAYS * DAY_MS;
}

export function forgetUnlock(store = defaultStore()) {
  remove(store, KEY_UNLOCK);
}

// 실패 n번째 → 2^(n-1)초 대기 (1, 2, 4, 8 ... 최대 60초)
export const delaySecondsFor = (failCount) => (failCount <= 0 ? 0 : Math.min(2 ** (failCount - 1), MAX_DELAY_SECONDS));

export function readFailures(store = defaultStore()) {
  const saved = readJson(store, KEY_FAIL);
  return {
    count: saved && Number.isInteger(saved.count) ? saved.count : 0,
    waitUntil: saved && typeof saved.waitUntil === 'number' ? saved.waitUntil : 0
  };
}

export function recordFailure(now = Date.now(), store = defaultStore()) {
  const count = readFailures(store).count + 1;
  const result = { count, waitUntil: now + delaySecondsFor(count) * 1000 };
  writeJson(store, KEY_FAIL, result);
  return result;
}

export function clearFailures(store = defaultStore()) {
  remove(store, KEY_FAIL);
}

export function readNumericPref(store = defaultStore()) {
  return readJson(store, KEY_NUMERIC) === true;
}

export function writeNumericPref(value, store = defaultStore()) {
  writeJson(store, KEY_NUMERIC, !!value);
}
