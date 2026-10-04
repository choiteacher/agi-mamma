import { describe, expect, it } from 'vitest';

import menu from '../../data/menu-sets.seed.json';
import recipes from '../../data/recipes.seed.json';
import { addDays, diffDays, weekday } from '../dates';
import { buildPlan, reusableIngredients } from '../planner';

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

  it('완료한 세트가 남아 있으면 끼니를 비워 두지 않는다', () => {
    const frz = SETS.filter((s) => s.freezable && s.month === 10);
    const p = plan({ cookLog: ['2026-10-01', '2026-10-02', '2026-10-03'].map((d, i) => log(d, frz[i].id)) });
    const firstTwoDays = p.meals.filter((m) => m.date <= addDays(TODAY, 1));
    // 지난주 만든 세 세트의 냉동분으로 일요일 3끼·월요일 2끼를 서로 다른 세트로 모두 채운다
    expect(firstTwoDays.every((m) => m.setId)).toBe(true);
  });

  it('같은 날 두 끼에 같은 세트를 내지 않는다(그것밖에 없으면 간단식으로 비움)', () => {
    const byDay = new Map();
    for (const m of plan().meals) byDay.set(m.date, [...(byDay.get(m.date) || []), m]);
    for (const list of byDay.values()) {
      const ids = list.map((m) => m.setId).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // 세트가 쌓인 2주 뒤부터는 간단식으로 비우는 끼니가 없다
    expect(plan().meals.filter((m) => m.date >= addDays(TODAY, 14) && !m.setId)).toEqual([]);
  });

  it('냉동해 둔 몫은 나중 끼니에 해동(freezer)으로 나온다', () => {
    const meals = plan().meals;
    const frozenUse = meals.filter((m) => m.source === 'freezer');
    expect(frozenUse.length).toBeGreaterThan(0);
    // 요리한 날이 아닌 뒷날에 나온다
    for (const m of frozenUse) expect(m.date > m.lotId.slice(5, 15)).toBe(true);
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

  it('완료해서 냉동분이 남은 세트는 새로 만들지 않는다', () => {
    const usual = planned(plan())[0];
    const p = plan({ cookLog: [log('2026-10-02', usual.setId)] });
    expect(planned(p)[0].setId).not.toBe(usual.setId);
  });
});

describe('재고 충분/소진', () => {
  // 냉동 가능한 10월 세트 4개를 10/1~10/4에 하나씩 만들었다고 기록 (쉬려면 서로 다른 세트 4개 이상 필요)
  const frz = SETS.filter((s) => s.month === 10 && s.freezable);
  const fourDone = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d, i) => log(d, frz[i].id));

  it('남은 양이 충분해도 세트 종류가 적으면 쉬지 않는다', () => {
    const p = plan({ cookLog: fourDone.slice(2) });
    expect(p.sessions.find((s) => s.date === '2026-10-05').status).toBe('planned');
  });

  it('앞으로 3일 치가 충분하면 그 요리 요일은 쉰다', () => {
    const p = plan({ cookLog: fourDone });
    expect(p.sessions.find((s) => s.date === '2026-10-05')).toMatchObject({ status: 'rest' });
  });

  it('남은 몫이 줄어 부족해지면 다음 요리 요일에 새 세션을 잡는다', () => {
    const p = plan({ cookLog: fourDone });
    const firstPlanned = planned(p)[0];
    expect(firstPlanned.date > '2026-10-05').toBe(true);
    expect([1, 3, 5]).toContain(weekday(firstPlanned.date));
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

describe('남은 재료 이어 쓰기', () => {
  const recipeOf = (id, name, items) => ({ id, name, ingredients: items.map((item) => ({ item, amount: '' })) });
  const rs = new Map(
    [
      recipeOf('r1', '애호박나물', ['애호박', '양파']),
      recipeOf('r2', '새우살애호박국', ['애호박', '칵테일새우']),
      recipeOf('r3', '쇠고기무국', ['무', '애호박', '소고기 국거리']),
      recipeOf('r4', '콩나물국', ['콩나물']),
      recipeOf('r5', '콩나물무침', ['콩나물', '참기름'])
    ].map((r) => [r.id, r])
  );
  const setOf = (id, protein, ...ids) => ({ id, protein, dishes: ids.map((r) => ({ role: 'dish', recipe_id: r, name: rs.get(r).name })) });

  it('남기 쉬운 재료를 다른 맛 요리에 곁들여 쓰면 이어 쓴다', () => {
    expect(reusableIngredients(setOf('a', '돼지고기', 'r1'), setOf('b', '소고기', 'r3'), rs)).toEqual(['애호박']);
  });
  it('두 세트 모두 그 재료가 주재료(요리 이름)면 맛이 비슷해 이어 쓰지 않는다', () => {
    expect(reusableIngredients(setOf('a', '돼지고기', 'r1'), setOf('b', '해산물', 'r2'), rs)).toEqual([]);
    expect(reusableIngredients(setOf('a', '돼지고기', 'r4'), setOf('b', '소고기', 'r5'), rs)).toEqual([]);
  });
  it('주 단백질이 같으면 이어 쓰지 않는다', () => {
    expect(reusableIngredients(setOf('a', '소고기', 'r1'), setOf('b', '소고기', 'r3'), rs)).toEqual([]);
  });
  it('양념·오래 두는 재료(양파, 참기름)는 따지지 않는다', () => {
    expect(reusableIngredients(setOf('a', '돼지고기', 'r1'), setOf('b', '소고기', 'r5'), rs)).toEqual([]);
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
