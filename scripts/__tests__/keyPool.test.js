import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AllKeysUnavailableError, FatalRequestError, KeyPool, classifyGeminiError, loadGeminiKeys } from '../lib/keyPool.mjs';

// 테스트용 가짜 키 (실제 키 형식과 다르게)
const KEYS = [
  { index: 1, value: 'fake-key-one-zzz' },
  { index: 2, value: 'fake-key-two-zzz' },
  { index: 3, value: 'fake-key-three-zzz' }
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keypool-'));
let n = 0;
const statePath = () => path.join(tmp, `state-${(n += 1)}.json`);
afterEach(() => {});

const make = (opts = {}) => {
  const logs = [];
  const pool = new KeyPool({
    keys: KEYS,
    statePath: statePath(),
    sleep: async () => {},
    log: (m) => logs.push(m),
    baseDelayMs: 1,
    ...opts
  });
  return { pool, logs };
};
// 키별로 정해 둔 응답을 차례로 돌려주는 가짜 요청
const scripted = (byKey) => {
  const calls = [];
  const fn = async (value) => {
    calls.push(value);
    const queue = byKey[value];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next;
  };
  fn.calls = calls;
  return fn;
};
const OK = { ok: true, data: 'done' };
const T429 = { ok: false, status: 429, body: '{"error":{"code":"rate_limit_exceeded"}}' };
const DAY = { ok: false, status: 429, body: '{"error":{"code":"quota_exceeded","message":"daily quota"}}' };
const BAD = { ok: false, status: 401, body: '{"error":{"code":"authentication"}}' };

describe('오류 분류', () => {
  it('분당 한도·5xx는 일시, 일일 한도는 소진, 401/키 오류는 무효, 400은 요청 문제', () => {
    expect(classifyGeminiError(429, T429.body)).toBe('transient');
    expect(classifyGeminiError(503, '')).toBe('transient');
    expect(classifyGeminiError(429, DAY.body)).toBe('exhausted');
    expect(
      classifyGeminiError(
        429,
        '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}'
      )
    ).toBe('exhausted');
    expect(classifyGeminiError(401, '')).toBe('invalid');
    expect(
      classifyGeminiError(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')
    ).toBe('invalid');
    expect(classifyGeminiError(400, '{"error":{"status":"INVALID_ARGUMENT"}}')).toBe('fatal');
  });

  it('키 목록: _1~_3 순서, 없으면 GEMINI_API_KEY 를 1번으로', () => {
    expect(loadGeminiKeys({ GEMINI_API_KEY_2: 'b', GEMINI_API_KEY_1: 'a' }).map((k) => k.index)).toEqual([1, 2]);
    expect(loadGeminiKeys({ GEMINI_API_KEY: 'x' })).toEqual([{ index: 1, value: 'x' }]);
  });
});

describe('기본(전환 안 함)', () => {
  it('1번 키만 쓰고, 소진되면 다른 키로 넘어가지 않고 멈춘다', async () => {
    const { pool } = make();
    const fn = scripted({ [KEYS[0].value]: [DAY], [KEYS[1].value]: [OK] });
    await expect(pool.call(fn)).rejects.toBeInstanceOf(AllKeysUnavailableError);
    expect(fn.calls).toEqual([KEYS[0].value]);
  });
});

describe('--rotate-keys', () => {
  it('일시 오류는 3회 재시도 후 다음 키로', async () => {
    const { pool, logs } = make({ rotate: true });
    const fn = scripted({ [KEYS[0].value]: [T429], [KEYS[1].value]: [OK] });
    expect(await pool.call(fn)).toBe('done');
    expect(fn.calls.filter((c) => c === KEYS[0].value)).toHaveLength(4); // 첫 시도 + 재시도 3회
    expect(logs.some((l) => l.includes('key #1'))).toBe(true);
  });

  it('일일 소진은 바로 다음 키로, 상태 파일에 번호와 시각만 저장', async () => {
    const sp = statePath();
    const { pool } = make({ rotate: true, statePath: sp });
    const fn = scripted({ [KEYS[0].value]: [DAY], [KEYS[1].value]: [OK] });
    expect(await pool.call(fn)).toBe('done');
    expect(fn.calls).toEqual([KEYS[0].value, KEYS[1].value]);
    const saved = fs.readFileSync(sp, 'utf8');
    expect(JSON.parse(saved).keys['1'].status).toBe('exhausted');
    for (const k of KEYS) expect(saved).not.toContain(k.value);
  });

  it('소진 표시는 다음 실행에도 유지되고, 24시간이 지나거나 --reset-keys 면 다시 쓴다', async () => {
    const sp = statePath();
    let t = Date.parse('2026-10-05T00:00:00Z');
    const first = make({ rotate: true, statePath: sp, now: () => t }).pool;
    await first.call(scripted({ [KEYS[0].value]: [DAY], [KEYS[1].value]: [OK] }));

    t += 60 * 60 * 1000;
    const second = make({ rotate: true, statePath: sp, now: () => t }).pool;
    const fn2 = scripted({ [KEYS[0].value]: [OK], [KEYS[1].value]: [OK] });
    await second.call(fn2);
    expect(fn2.calls[0]).toBe(KEYS[1].value);

    t += 24 * 60 * 60 * 1000;
    const third = make({ rotate: true, statePath: sp, now: () => t }).pool;
    const fn3 = scripted({ [KEYS[0].value]: [OK], [KEYS[1].value]: [OK] });
    await third.call(fn3);
    expect(fn3.calls[0]).toBe(KEYS[0].value);

    const reset = make({ rotate: true, statePath: sp, resetState: true }).pool;
    expect(reset.usableKeys().map((k) => k.index)).toEqual([1, 2, 3]);
  });

  it('인증 오류 키는 무효로 표시하고 번호만 알린다', async () => {
    const { pool, logs } = make({ rotate: true });
    const fn = scripted({ [KEYS[0].value]: [BAD], [KEYS[1].value]: [OK] });
    expect(await pool.call(fn)).toBe('done');
    expect(logs.join('\n')).toMatch(/key #1: 인증 오류/);
    for (const k of KEYS) expect(logs.join('\n')).not.toContain(k.value);
  });

  it('모든 키가 소진되면 AllKeysUnavailableError', async () => {
    const { pool } = make({ rotate: true });
    const fn = scripted({ [KEYS[0].value]: [DAY], [KEYS[1].value]: [DAY], [KEYS[2].value]: [BAD] });
    await expect(pool.call(fn)).rejects.toBeInstanceOf(AllKeysUnavailableError);
  });

  it('요청 내용 문제(400)는 키를 바꾸지 않고 바로 오류', async () => {
    const { pool } = make({ rotate: true });
    const fn = scripted({ [KEYS[0].value]: [{ ok: false, status: 400, body: '{"error":{"status":"INVALID_ARGUMENT"}}' }] });
    await expect(pool.call(fn)).rejects.toBeInstanceOf(FatalRequestError);
    expect(fn.calls).toHaveLength(1);
  });
});
