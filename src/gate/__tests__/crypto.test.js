import { describe, expect, it } from 'vitest';

import { hashPassword, MIN_ITERATIONS } from '../../../scripts/lib/gateHash.mjs';
import { isValidGate, verifyPassword } from '../crypto';

// 테스트용 값일 뿐 실제 사이트 비밀번호와 무관하다.
const SAMPLE = 'test-only-돼지3';

describe('gate crypto', () => {
  const gate = hashPassword(SAMPLE, { iterations: MIN_ITERATIONS });

  it('Node(set-password)에서 만든 해시를 브라우저 방식(WebCrypto)으로 검증할 수 있다', async () => {
    expect(await verifyPassword(SAMPLE, gate)).toBe(true);
  });

  it('틀린 비밀번호와 빈 값은 거부한다', async () => {
    expect(await verifyPassword('test-only-돼지4', gate)).toBe(false);
    expect(await verifyPassword('', gate)).toBe(false);
  });

  it('한글 조합 방식(NFC/NFD)이 달라도 같은 비밀번호로 본다', async () => {
    expect(await verifyPassword(SAMPLE.normalize('NFD'), gate)).toBe(true);
  });

  it('gate.json에는 salt, iterations, hash만 있다', () => {
    expect(Object.keys(gate).sort()).toEqual(['hash', 'iterations', 'salt']);
    expect(JSON.stringify(gate)).not.toContain(SAMPLE);
  });

  it('같은 비밀번호라도 salt가 무작위라 해시가 매번 다르다', () => {
    const again = hashPassword(SAMPLE, { iterations: MIN_ITERATIONS });
    expect(again.salt).not.toBe(gate.salt);
    expect(again.hash).not.toBe(gate.hash);
  });

  it('반복 횟수가 최소값보다 적으면 만들지도, 받아들이지도 않는다', async () => {
    expect(() => hashPassword(SAMPLE, { iterations: 1000 })).toThrow();
    const weak = { ...gate, iterations: 1000 };
    expect(isValidGate(weak)).toBe(false);
    expect(await verifyPassword(SAMPLE, weak)).toBe(false);
  });
});
