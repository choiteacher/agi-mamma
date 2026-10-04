import { describe, expect, it } from 'vitest';

import { buildExport, decodeShareCode, encodeShareCode, mergeData, validateImport } from '../sync';

const log = (id, updated, extra = {}) => ({ id, date: '2026-10-05', setId: 's', status: 'done', updated_at: updated, ...extra });

describe('병합 (id 기준 합집합, 같은 id는 최신 updated_at)', () => {
  const local = {
    settings: { cookWeekdays: [1, 3, 5], updated_at: '2026-10-01T00:00:00Z' },
    cookLog: [log('a', '2026-10-05T10:00:00Z'), log('b', '2026-10-05T10:00:00Z', { status: 'cooking' })],
    stock: [{ id: 'x', portions: 3, updated_at: '2026-10-05T10:00:00Z' }]
  };
  const incoming = {
    settings: { cookWeekdays: [2, 4], updated_at: '2026-10-03T00:00:00Z' },
    cookLog: [
      log('b', '2026-10-05T12:00:00Z', { status: 'done' }),
      log('c', '2026-10-06T09:00:00Z'),
      log('a', '2026-10-04T00:00:00Z', { status: 'skipped' })
    ],
    stock: [
      { id: 'x', portions: 1, updated_at: '2026-10-04T00:00:00Z' },
      { id: 'y', portions: 2, updated_at: '2026-10-06T00:00:00Z' }
    ]
  };

  it('새 항목은 더하고, 같은 id는 더 최근 것을 쓴다', () => {
    const { merged, summary } = mergeData(local, incoming);
    const byId = Object.fromEntries(merged.cookLog.map((e) => [e.id, e]));
    expect(byId.a.status).toBe('done'); // 내 것이 더 최근
    expect(byId.b.status).toBe('done'); // 가져온 것이 더 최근
    expect(byId.c).toBeTruthy();
    expect(summary.cookLog).toEqual({ added: 1, updated: 1, unchanged: 1 });
    expect(merged.stock.find((s) => s.id === 'x').portions).toBe(3);
    expect(summary.stock).toEqual({ added: 1, updated: 0, unchanged: 1 });
  });

  it('설정은 updated_at이 더 최근인 쪽을 쓴다', () => {
    expect(mergeData(local, incoming).merged.settings.cookWeekdays).toEqual([2, 4]);
    const older = { ...incoming, settings: { cookWeekdays: [2], updated_at: '2026-09-01T00:00:00Z' } };
    const r = mergeData(local, older);
    expect(r.merged.settings.cookWeekdays).toEqual([1, 3, 5]);
    expect(r.summary.settings).toBe('local');
  });

  it('지운 항목(deleted 표시)도 최신이면 반영된다', () => {
    const r = mergeData(local, { ...incoming, stock: [{ id: 'x', portions: 3, deleted: true, updated_at: '2026-10-07T00:00:00Z' }] });
    expect(r.merged.stock.find((s) => s.id === 'x').deleted).toBe(true);
  });

  it('같은 데이터를 두 번 가져와도 결과가 같다', () => {
    const once = mergeData(local, incoming).merged;
    expect(mergeData(once, incoming).merged).toEqual(once);
  });
});

describe('공유 코드', () => {
  const data = buildExport(
    { settings: { cookWeekdays: [1, 3, 5] }, cookLog: [log('a', '2026-10-05T10:00:00Z')], stock: [] },
    '2026-10-05T00:00:00Z'
  );

  it('내보낸 코드를 다시 가져오면 같은 데이터가 나온다(압축)', async () => {
    const code = await encodeShareCode(data);
    expect(code.startsWith('AGM1.')).toBe(true);
    expect(code).toMatch(/^AGM1\.[A-Za-z0-9_-]+$/);
    expect(await decodeShareCode(code)).toEqual(data);
  });

  it('붙여 넣을 때 섞인 줄바꿈/공백은 무시한다', async () => {
    const code = await encodeShareCode(data);
    expect(await decodeShareCode(` ${code.slice(0, 10)}\n${code.slice(10)} `)).toEqual(data);
  });

  it('잘린 코드나 다른 앱 데이터는 알기 쉬운 오류를 낸다', async () => {
    const code = await encodeShareCode(data);
    await expect(decodeShareCode(code.slice(0, code.length - 8))).rejects.toThrow(/손상|형식/);
    await expect(decodeShareCode('hello')).rejects.toThrow(/형식/);
    expect(() => validateImport({ app: 'other' })).toThrow(/아기돼지/);
  });
});
