import { describe, expect, it } from 'vitest';

import { clearFailures, delaySecondsFor, forgetUnlock, isRemembered, readFailures, recordFailure, rememberUnlock } from '../storage';

const memoryStore = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    dump: () => [...data.values()].join('\n')
  };
};

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 4);
const gate = { salt: 'c2FsdHNhbHRzYWx0c2FsdA==', iterations: 600000, hash: 'x' };

describe('잠금 해제 기억 (30일)', () => {
  it('해제 직후와 29일 뒤에는 기억, 30일이 지나면 만료', () => {
    const store = memoryStore();
    rememberUnlock(gate, NOW, store);
    expect(isRemembered(gate, NOW, store)).toBe(true);
    expect(isRemembered(gate, NOW + 29 * DAY, store)).toBe(true);
    expect(isRemembered(gate, NOW + 30 * DAY, store)).toBe(false);
  });

  it('비밀번호를 바꾸면(salt 변경) 기존 기억은 무효', () => {
    const store = memoryStore();
    rememberUnlock(gate, NOW, store);
    expect(isRemembered({ ...gate, salt: 'b3RoZXJzYWx0b3RoZXI=' }, NOW, store)).toBe(false);
  });

  it('잠그기를 누르면 기억이 지워진다', () => {
    const store = memoryStore();
    rememberUnlock(gate, NOW, store);
    forgetUnlock(store);
    expect(isRemembered(gate, NOW, store)).toBe(false);
  });

  it('만료 시각을 먼 미래로 조작한 값은 받아들이지 않는다', () => {
    const store = memoryStore();
    store.setItem('agi-mamma.gate.unlock', JSON.stringify({ until: NOW + 365 * DAY, tag: gate.salt.slice(0, 8) }));
    expect(isRemembered(gate, NOW, store)).toBe(false);
  });

  it('저장소가 없거나 오류를 내도 동작한다(잠긴 상태로 처리)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    };
    expect(() => rememberUnlock(gate, NOW, broken)).not.toThrow();
    expect(isRemembered(gate, NOW, broken)).toBe(false);
    expect(isRemembered(gate, NOW, null)).toBe(false);
  });

  it('저장소에는 비밀번호가 아니라 만료 시각과 표시값만 남는다', () => {
    const store = memoryStore();
    rememberUnlock(gate, NOW, store);
    const saved = JSON.parse(store.getItem('agi-mamma.gate.unlock'));
    expect(Object.keys(saved).sort()).toEqual(['tag', 'until']);
  });
});

describe('실패 시 입력 지연', () => {
  it('1, 2, 4, 8초 … 최대 60초', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(delaySecondsFor)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
    expect(delaySecondsFor(0)).toBe(0);
  });

  it('실패가 누적되고, 성공하면 초기화된다', () => {
    const store = memoryStore();
    recordFailure(NOW, store);
    recordFailure(NOW, store);
    const third = recordFailure(NOW, store);
    expect(third).toEqual({ count: 3, waitUntil: NOW + 4000 });
    expect(readFailures(store).count).toBe(3);
    clearFailures(store);
    expect(readFailures(store)).toEqual({ count: 0, waitUntil: 0 });
  });
});
