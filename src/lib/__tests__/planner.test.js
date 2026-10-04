import { describe, expect, it } from 'vitest';

import menu from '../../data/menu-sets.seed.json';
import recipes from '../../data/recipes.seed.json';
import { addDays, diffDays, weekday } from '../dates';
import { buildPlan } from '../planner';

const TODAY = '2026-10-04'; // 일요일
const SETS = menu.sets;
const plan = (extra = {}) => buildPlan({ sets: SETS, recipes, today: TODAY, ...extra });
const planned = (p) => p.sessions.filter((s) => s.status === 'planned' || s.status === 'cooking');
const log = (date, setId, status = 'done', extra = {}) => ({
  id: `log-${date}`,
  date,
  setId,
  status,
  updated_at: `${date}T12:00:00Z`,
  ...extra
});

describe('일정 범위와 기본 규칙', () => {
  it('같은 입력이면 같은 결과', () => {
    expect(plan()).toEqual(plan());
  });

  it('이번 달 1일 ~ 다음 달 말일 범위, 요리는 오늘 이후 월·수·금에만', () => {
    const p = plan();
    expect(p.horizon).toEqual({ start: '2026-10-01', end: '2026-11-30' });
    for (const s of planned(p)) {
      expect(s.date >= TODAY).toBe(true);
      expect([1, 3, 5]).toContain(weekday(s.date));
    }
    expect(planned(p)[0].date).toBe('2026-10-05');
  });

  it('10월 요리는 10월 기준 세트, 11월 요리는 11월 기준 세트에서 고른다', () => {
    const byId = new Map(SETS.map((s) => [s.id, s]));
    for (const s of planned(plan())) expect(byId.get(s.setId).month).toBe(Number(s.date.slice(5, 7)));
  });

  it('같은 세트는 14일 안에 다시 만들지 않는다', () => {
    const list = planned(plan());
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].setId === list[j].setId) expect(diffDays(list[j].date, list[i].date)).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it('같은 세트를 같은 날 두 번 또는 이틀 연달아 먹이는 것은 다른 재고가 없을 때만(repeat 표시)', () => {
    const meals = plan().meals.filter((m) => m.setId);
    const byDay = new Map();
    for (const m of meals) byDay.set(m.date, [...(byDay.get(m.date) || []), m]);
    for (const [d, list] of byDay) {
      const seen = new Set();
      for (const m of list) {
        if (seen.has(m.setId)) expect(m.repeat).toBe(true);
        seen.add(m.setId);
      }
      const prevIds = (byDay.get(addDays(d, -1)) || []).map((m) => m.setId);
      for (const m of list) if (prevIds.includes(m.setId)) expect(m.repeat).toBe(true);
    }
  });

  it('두 달 동안 여러 세트가 고르게 돌아간다', () => {
    const ids = planned(plan()).map((s) => s.setId);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(Math.min(ids.length, 15));
  });

  it('요리한 날 아침에는 그날 만든 세트를 먹이지 않는다', () => {
    const p = plan();
    for (const s of planned(p)) {
      const breakfast = p.meals.find((m) => m.date === s.date && m.slot === '아침');
      expect(breakfast.setId === s.setId && breakfast.planned).toBe(false);
    }
  });

  it('재고가 있는데 끼니를 비워 두지 않는다', () => {
    const p = plan({ stock: [{ id: 'one', setId: SETS[0].id, location: 'fridge', portions: 4, date: TODAY, asOf: TODAY }] });
    const firstTwoDays = p.meals.filter((m) => m.date <= addDays(TODAY, 1));
    // 일요일 3끼 + 월요일 2끼 = 5끼: 재고 4끼 + 월요일에 새로 만든 세트로 모두 채운다
    expect(firstTwoDays.every((m) => m.setId)).toBe(true);
  });
});

describe('난이도 제한', () => {
  it('어려운 요리(난이도 3)가 2개 이상인 세트는 고르지 않는다', () => {
    const hard = { ...SETS[0], id: 'hard-set', month: 10, hard_count: 2, difficulty_max: 1, active_minutes: 1, protein: '기타' };
    const p = buildPlan({ sets: [hard, ...SETS], recipes, today: TODAY });
    expect(planned(p).map((s) => s.setId)).not.toContain('hard-set');
  });
});

describe('체크(요리 완료) 후 재조정', () => {
  it('완료한 세트는 그날 만든 것으로 처리되고 14일 안 미래 일정에서 빠진다', () => {
    const first = planned(plan())[0];
    const p = plan({
      cookLog: [log(first.date, first.setId)],
      stock: [{ id: 'st1', setId: first.setId, location: 'fridge', portions: 3, date: first.date, asOf: first.date }],
      today: first.date
    });
    const s = p.sessions.find((x) => x.date === first.date);
    expect(s.status).toBe('done');
    const again = planned(p).filter((x) => x.setId === first.setId);
    for (const a of again) expect(diffDays(a.date, first.date)).toBeGreaterThanOrEqual(14);
  });

  it('과거 기록은 다시 계산하지 않고 그대로 보여 준다', () => {
    const past = log('2026-10-02', SETS[3].id);
    const p = plan({ cookLog: [past] });
    expect(p.sessions.find((s) => s.date === '2026-10-02')).toMatchObject({ status: 'done', setId: SETS[3].id });
  });

  it('재고에 남아 있는 세트는 새로 만들지 않는다', () => {
    // 재고가 없으면 첫 세션에 고를 세트를 재고에 넣어 둔다
    const usual = planned(plan())[0];
    const p = plan({ stock: [{ id: 'st', setId: usual.setId, location: 'freezer', portions: 6, date: '2026-09-20', asOf: TODAY }] });
    const first = planned(p)[0];
    expect(p.stockRemaining.st).toBeGreaterThan(0);
    expect(first.setId).not.toBe(usual.setId);
  });
});

describe('재고 충분/소진', () => {
  const tenOct = SETS.filter((s) => s.month === 10);
  // 쉬려면 서로 다른 세트가 4개(minStockVariety) 이상 있어야 한다
  const bigStock = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id,
    setId: tenOct[i].id,
    location: 'freezer',
    portions: 3,
    date: '2026-10-01',
    asOf: TODAY
  }));

  it('재고 양이 충분해도 세트 종류가 적으면 쉬지 않는다', () => {
    const p = plan({ stock: bigStock.slice(0, 2).map((s) => ({ ...s, portions: 6 })) });
    expect(p.sessions.find((s) => s.date === '2026-10-05').status).toBe('planned');
  });

  it('앞으로 3일 치 재고가 충분하면 그 요리 요일은 쉰다', () => {
    const p = plan({ stock: bigStock });
    expect(p.sessions.find((s) => s.date === '2026-10-05')).toMatchObject({ status: 'rest' });
  });

  it('재고가 줄어 부족해지면 다음 요리 요일에 새 세션을 잡는다', () => {
    const p = plan({ stock: bigStock });
    const firstPlanned = planned(p)[0];
    expect(firstPlanned.date > '2026-10-05').toBe(true);
    expect([1, 3, 5]).toContain(weekday(firstPlanned.date));
  });

  it('오늘 아침 기준 재고 남은 끼니 수를 알려 준다', () => {
    const p = plan({ stock: bigStock });
    expect(p.stockRemaining).toEqual({ a: 3, b: 3, c: 3, d: 3 });
    const later = buildPlan({ sets: SETS, recipes, stock: bigStock, today: '2026-10-06' });
    expect(Object.values(later.stockRemaining).reduce((x, y) => x + y, 0)).toBeLessThan(12);
  });
});

describe('미루기 / 못 했어요', () => {
  it('오늘 세션을 미루면 오늘은 요리하지 않고 그 세트는 다음 요리 요일로 넘어간다', () => {
    const monday = '2026-10-05';
    const before = buildPlan({ sets: SETS, recipes, today: monday });
    const todaySet = planned(before)[0];
    expect(todaySet.date).toBe(monday);
    const after = buildPlan({ sets: SETS, recipes, today: monday, cookLog: [log(monday, null, 'skipped')] });
    expect(after.sessions.find((s) => s.date === monday).status).toBe('skipped');
    expect(planned(after)[0]).toMatchObject({ date: '2026-10-07', setId: todaySet.setId });
  });

  it('미루기를 취소하면(기록 삭제) 원래 일정으로 돌아간다', () => {
    const monday = '2026-10-05';
    const original = buildPlan({ sets: SETS, recipes, today: monday });
    const undone = buildPlan({ sets: SETS, recipes, today: monday, cookLog: [log(monday, null, 'skipped', { deleted: true })] });
    expect(undone.sessions).toEqual(original.sessions);
  });
});

describe('즐겨찾기', () => {
  it('즐겨찾기 세트도 7일 안에는 다시 만들지 않는다', () => {
    const p = plan({ settings: { favorites: SETS.map((s) => s.id) } });
    const list = planned(p);
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].setId === list[j].setId) expect(diffDays(list[j].date, list[i].date)).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe('기피 재료', () => {
  it('기피 재료가 들어간 세트는 고르지 않는다', () => {
    const p = plan({ settings: { avoidIngredients: ['오징어'] } });
    const byId = new Map(SETS.map((s) => [s.id, s]));
    for (const s of planned(p)) {
      const names = byId
        .get(s.setId)
        .dishes.map((d) => d.name)
        .join(' ');
      expect(names).not.toContain('오징어');
    }
  });
});
