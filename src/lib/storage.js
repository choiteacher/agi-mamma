// 저장 계층(storage adapter). 지금은 브라우저 localStorage를 쓰고, 나중에 DB로 바꿀 때 이 모듈만 교체한다.
// 모든 사용자 데이터(설정, 요리 기록, 재고)가 이 인터페이스를 거친다.
//   adapter.load(key, fallback) → 값
//   adapter.save(key, value)    → 저장 성공 여부
//   adapter.remove(key)

const PREFIX = 'agi-mamma.data.';

export function createLocalStorageAdapter(store = safeLocalStorage(), prefix = PREFIX) {
  return {
    load(key, fallback) {
      try {
        const raw = store && store.getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    save(key, value) {
      try {
        if (!store) return false;
        store.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        if (store) store.removeItem(prefix + key);
      } catch {
        // 무시
      }
    }
  };
}

export function createMemoryAdapter(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    load: (key, fallback) => (data.has(key) ? JSON.parse(data.get(key)) : fallback),
    save: (key, value) => {
      data.set(key, JSON.stringify(value));
      return true;
    },
    remove: (key) => data.delete(key)
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export const newId = () =>
  globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

export const nowIso = () => new Date().toISOString();
