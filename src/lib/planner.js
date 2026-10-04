// 요리 일정 재조정 (규칙 기반 순수 함수, LLM 호출 없음)
//
// 입력: 세트(menu-sets.seed.json), 레시피, 설정, 요리 기록(cookLog), 오늘 날짜
//   (냉장·냉동 재고는 사용자가 직접 관리한다. 끼니표는 완료한 세트를 제안대로 냉장·냉동했다고 보고 계산한다)
// 출력: 이번 달 1일 ~ 다음 달 말일 범위의
//   sessions: 요리 세션(요리 요일마다 'done' | 'cooking' | 'planned' | 'rest' | 'skipped')
//   meals:    오늘부터 끼니별로 어떤 세트를 먹일지 (요리한 날/냉장/해동/없음)
//
// 원칙
// - 세트는 통째로 쓴다. 날짜의 "달"과 같은 달(작년 같은 달) 식단 세트에서 고른다.
// - 오늘 이전 세션은 기록(cookLog)만 보여 주고 다시 계산하지 않는다.
// - 재고가 앞으로 며칠 치 충분하면 그 요리 요일은 쉰다. 재고에 남아 있는 세트는 새로 만들지 않는다.
// - 직전 요리에서 남았을 법한 채소·두부 등을 쓰는 세트를 조금 우선한다. 단, 그 재료가 두 세트 모두에서
//   요리 이름에 들어가는 주재료이거나(콩나물국 → 콩나물무침) 주 단백질이 같으면 맛이 비슷해 반영하지 않는다.
// - 끼니는 가장 오래 안 먹은 세트부터 돌려 같은 날 아침·저녁이 같지 않게 한다.
// - 같은 세트는 reuseBanDays(즐겨찾기는 favoriteReuseDays) 안에 다시 만들지 않는다.
// - 같은 세트를 이틀 연달아(또는 같은 날 두 번) 먹이지 않는다.
// - 세션당 난이도 3 이상 요리는 최대 1개.
// - 같은 입력이면 같은 결과(고정 시드로 동점 정리).
import { addDays, diffDays, firstOfMonth, isWeekend, lastOfNextMonth, monthOf, rangeDays, weekStart, weekday } from './dates.js';
import { DEFAULT_SETTINGS, WEEKDAY_SLOTS, WEEKEND_SLOTS } from '../config/defaults.js';

export const slotsOf = (ymd) => (isWeekend(ymd) ? WEEKEND_SLOTS : WEEKDAY_SLOTS);

// 시드 고정 해시 (0~1)
const hash01 = (...parts) => {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
};

const latestByDate = (cookLog) => {
  const map = new Map();
  for (const e of cookLog) {
    if (e.deleted) continue;
    const prev = map.get(e.date);
    if (!prev || (e.updated_at || '') > (prev.updated_at || '')) map.set(e.date, e);
  }
  return map;
};

const setHasAvoided = (set, recipesById, avoid) => {
  if (!avoid.length) return false;
  const words = set.dishes.flatMap((d) => {
    const r = d.recipe_id && recipesById.get(d.recipe_id);
    return [d.name, ...(r ? r.ingredients.map((i) => i.item) : [])];
  });
  return avoid.some((a) => a && words.some((w) => w.includes(a)));
};

// 남기 쉬운 재료(한 번에 다 못 쓰고 며칠 안에 시드는 채소·두부 등). 양파·당근·감자처럼 오래 두는 것과 양념은 뺀다.
const LEFTOVER_PRONE =
  /^(애호박|두부|부침용 두부|순두부|대파|쪽파|팽이버섯|느타리|표고버섯|청경채|양배추|무|브로콜리|콩나물|숙주|시금치|단호박|파프리카|깻잎|오이|가지|얼갈이배추|근대|상추|부추|배추)$/;
const ingredientKey = (item) =>
  item
    .replace(/(.*?)/g, '')
    .replace(/s*(또는|or)s.*$/, '')
    .trim();

export function setIngredients(set, recipesById) {
  const out = new Set();
  for (const d of set.dishes) {
    const r = d.role === 'dish' && d.recipe_id && recipesById.get(d.recipe_id);
    if (!r) continue;
    for (const i of r.ingredients) {
      const k = ingredientKey(i.item);
      if (LEFTOVER_PRONE.test(k)) out.add(k);
    }
  }
  return out;
}

// prev 세트에서 남았을 재료 중 next 세트가 "맛이 겹치지 않게" 이어 쓸 수 있는 것
export function reusableIngredients(prev, next, recipesById) {
  if (!prev || !next || prev.id === next.id || prev.protein === next.protein) return [];
  const headline = (set, k) => set.dishes.some((d) => d.role === 'dish' && d.name.replace(/s+/g, '').includes(k.replace(/s+/g, '')));
  const a = setIngredients(prev, recipesById);
  return [...setIngredients(next, recipesById)].filter((k) => a.has(k) && !(headline(prev, k) && headline(next, k))).sort();
}

export function buildPlan({ sets, recipes = [], settings: userSettings = {}, cookLog = [], today }) {
  const settings = { ...DEFAULT_SETTINGS, ...userSettings };
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const start = firstOfMonth(today);
  const end = lastOfNextMonth(today);
  const logs = latestByDate(cookLog);
  const warnings = [];

  // ---- 재고 묶음(lot). 완료한 세션과 앞으로 만들 세션이 만드는 몫(제안대로 냉장·냉동했다고 가정)
  const lots = [];

  // ---- 세트별 마지막 요리 날짜 (재제작 금지 판단)
  const lastCooked = new Map();
  for (const e of cookLog) {
    if (e.deleted || e.status !== 'done') continue;
    if (!lastCooked.has(e.setId) || lastCooked.get(e.setId) < e.date) lastCooked.set(e.setId, e.date);
  }

  const sessions = [];
  // 과거 세션: 기록 그대로
  for (const [date, e] of [...logs.entries()].sort()) {
    if (date < start || date >= today) continue;
    sessions.push({
      date,
      setId: e.setId || null,
      status: e.status === 'done' ? 'done' : e.status === 'skipped' ? 'skipped' : 'done',
      logId: e.id
    });
  }

  const usedInPlan = new Map();
  const banDays = (setId) => (settings.favorites.includes(setId) ? settings.favoriteReuseDays : settings.reuseBanDays);

  const chooseSet = (d) => {
    const inStock = new Set(lots.filter((l) => l.remaining > 0).map((l) => l.setId));
    let pool = sets.filter((s) => s.month === monthOf(d));
    if (!pool.length) {
      pool = sets;
      warnings.push(`${d}: 이 달 기준 식단 세트가 없어 다른 달 세트에서 골랐습니다.`);
    }
    const base = pool.filter((s) => s.hard_count <= 1 && !setHasAvoided(s, recipesById, settings.avoidIngredients));
    let candidates = base.filter((s) => {
      if (inStock.has(s.id)) return false;
      const last = lastCooked.get(s.id);
      return !last || diffDays(d, last) >= banDays(s.id);
    });
    if (!candidates.length) {
      candidates = base;
      if (!candidates.length) return null;
      warnings.push(`${d}: 조건에 맞는 세트가 없어 가장 오래전에 만든 세트를 다시 골랐습니다.`);
    }
    const wk = weekStart(d);
    const weekProteins = sessions.filter((s) => s.setId && weekStart(s.date) === wk).map((s) => setsById.get(s.setId)?.protein);
    const prev = [...sessions].reverse().find((s) => s.setId && s.date < d);
    const prevProtein = prev && setsById.get(prev.setId)?.protein;
    // 직전 요리가 나흘 안이면, 그때 남았을 재료를 맛이 겹치지 않게 이어 쓰는 세트를 조금 우선
    const prevSet = prev && diffDays(d, prev.date) <= 4 ? setsById.get(prev.setId) : null;
    const reuse = (s) => reusableIngredients(prevSet, s, recipesById);
    const score = (s) =>
      s.hard_count * 100 +
      s.difficulty_max * 10 +
      s.active_minutes / 10 +
      (weekProteins.includes(s.protein) ? 30 : 0) +
      (s.protein === prevProtein ? 20 : 0) +
      (usedInPlan.get(s.id) || 0) * 60 + // 이번 계획에서 덜 쓴 세트 우선(여러 세트가 고르게 돌아가도록)
      (lastCooked.has(s.id) && diffDays(d, lastCooked.get(s.id)) < 28 ? 25 : 0) -
      Math.min(reuse(s).length, 2) * 12 +
      hash01(settings.seed, d, s.id) * 0.5;
    const best = [...candidates].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0];
    return best && { set: best, reuse: reuse(best) };
  };

  const usableOn = (lot, d) => {
    if (lot.remaining <= 0 || d < lot.from) return false;
    if (lot.location === 'fridge' && diffDays(d, lot.cooked) > settings.fridgeDays) return false;
    return true;
  };

  const meals = [];
  const servedBy = new Map(); // date → Set(setId)
  const lastServed = new Map(); // setId → 마지막으로 먹인 날
  // 3주 전 요리부터 따라가며 냉동분이 언제 쓰였을지 계산한다(그 전 냉동분은 계산에서 뺀다)
  const simStart = addDays(today, -21);
  const plannedLots = new Map(); // session date → lot

  for (const d of rangeDays(simStart, end)) {
    const future = d >= today;

    // 1) 냉장 기간이 지난 몫 처리: 예정 재고는 냉동 가능하면 냉동으로, 아니면 남김(어른 몫)
    for (const lot of lots) {
      if (lot.location !== 'fridge' || lot.remaining <= 0 || diffDays(d, lot.cooked) <= settings.fridgeDays) continue;
      if (lot.planned && lot.freezable) {
        lot.toFreezer = (lot.toFreezer || 0) + lot.remaining;
        lot.location = 'freezer';
      } else {
        lot.leftover = (lot.leftover || 0) + lot.remaining;
        lot.remaining = 0;
      }
    }

    // 2) 요리 세션. 지난 날은 완료 기록만 몫으로 넣고(세션 목록은 위에서 기록 그대로), 오늘부터 새로 계산
    if (!future) {
      const log = logs.get(d);
      if (log && log.status !== 'skipped' && setsById.has(log.setId)) addLots(d, setsById.get(log.setId));
    } else {
      const log = logs.get(d);
      const isCookDay = settings.cookWeekdays.includes(weekday(d));
      if (log && log.status === 'done') {
        sessions.push({ date: d, setId: log.setId, status: 'done', logId: log.id });
        if (setsById.has(log.setId)) addLots(d, setsById.get(log.setId));
        if (!lastCooked.has(log.setId) || lastCooked.get(log.setId) < d) lastCooked.set(log.setId, d);
      } else if (log && log.status === 'skipped') {
        sessions.push({ date: d, setId: null, status: 'skipped', logId: log.id });
      } else if (log && log.status === 'cooking') {
        addPlannedSession(d, setsById.get(log.setId), 'cooking', log.id);
      } else if (isCookDay) {
        const window = rangeDays(d, addDays(d, settings.lookaheadDays - 1));
        const needed = window.reduce((a, x) => a + slotsOf(x).length, 0);
        const usable = lots.filter(
          (l) =>
            l.remaining > 0 &&
            (l.location === 'freezer' || l.freezable || diffDays(addDays(d, settings.lookaheadDays - 1), l.cooked) <= settings.fridgeDays)
        );
        const available = usable.reduce((a, l) => a + l.remaining, 0);
        const distinct = new Set(usable.map((l) => l.setId)).size;
        if (available >= needed && distinct >= settings.minStockVariety) {
          sessions.push({ date: d, setId: null, status: 'rest', reason: `재고 ${available}끼분으로 ${settings.lookaheadDays}일 충분` });
        } else {
          const pick = chooseSet(d);
          if (pick) addPlannedSession(d, pick.set, 'planned', undefined, pick.reuse);
          else sessions.push({ date: d, setId: null, status: 'rest', reason: '고를 수 있는 세트가 없음' });
        }
      }
    }

    // 3) 끼니 배정
    const yesterday = servedBy.get(addDays(d, -1)) || new Set();
    const todaySets = new Set();
    for (const slot of slotsOf(d)) {
      const cookedToday = (l) => l.planned && l.cooked === d;
      const lastServedOf = (l) => lastServed.get(l.setId) || '';
      // 가장 오래 안 먹은 세트 먼저(돌려 먹이기). 같으면 냉장(빨리 먹어야 함) → 해동 순, 먼저 만든 것 먼저
      const order = (list) =>
        list.sort(
          (a, b) =>
            (lastServedOf(a) < lastServedOf(b) ? -1 : lastServedOf(a) > lastServedOf(b) ? 1 : 0) ||
            (a.location === 'fridge' ? 0 : 1) - (b.location === 'fridge' ? 0 : 1) ||
            (a.cooked < b.cooked ? -1 : a.cooked > b.cooked ? 1 : 0) ||
            a.id.localeCompare(b.id)
        )[0];
      const usable = lots.filter((l) => usableOn(l, d) && !(cookedToday(l) && slot === '아침'));
      // 어제 먹은 세트는 피하되, 다른 게 없으면 이어서 먹인다(repeat 표시).
      // 같은 날 아침·저녁에 같은 세트는 내지 않는다. 그것밖에 없으면 그 끼니는 간단식으로 비워 둔다(variety 표시).
      const fresh = order(usable.filter((l) => !yesterday.has(l.setId) && !todaySets.has(l.setId)));
      const pick = fresh || order(usable.filter((l) => !todaySets.has(l.setId)));
      const repeat = !fresh && !!pick;
      const variety = !pick && usable.length > 0;
      if (pick) {
        pick.remaining -= 1;
        pick.served = pick.served || [];
        pick.served.push(d);
        if (pick.location === 'fridge') pick.fromFridge = (pick.fromFridge || 0) + 1;
        todaySets.add(pick.setId);
        lastServed.set(pick.setId, d);
      }
      if (future) {
        meals.push({
          date: d,
          slot,
          setId: pick ? pick.setId : null,
          lotId: pick ? pick.id : null,
          source: pick ? (pick.planned && pick.cooked === d ? 'fresh' : pick.location) : null,
          planned: pick ? pick.planned : false,
          repeat,
          variety
        });
      }
    }
    servedBy.set(d, todaySets);
  }

  // 요리한 날 저녁에 한 끼 먹이고, 냉동 가능한 세트는 나머지를 바로 냉동해 다른 날 돌려 먹인다.
  // 냉동이 안 되는 세트는 냉장 보관 기간 안에 먹이고 남으면 어른 몫으로 둔다.
  function addPlannedSession(d, set, status, logId, reuse = []) {
    if (!set) return;
    addLots(d, set);
    sessions.push({ date: d, setId: set.id, status, logId, ...(reuse.length ? { reuse } : {}) });
    lastCooked.set(set.id, d);
    usedInPlan.set(set.id, (usedInPlan.get(set.id) || 0) + 1);
  }

  function addLots(d, set) {
    const total = settings.childMealsPerSet;
    const fresh = set.freezable ? 1 : total;
    const lot = {
      id: `plan-${d}`,
      setId: set.id,
      location: 'fridge',
      remaining: fresh,
      from: d,
      cooked: d,
      planned: true,
      freezable: false
    };
    lots.push(lot);
    if (set.freezable && total > fresh) {
      const frozen = {
        id: `plan-${d}-frz`,
        setId: set.id,
        location: 'freezer',
        remaining: total - fresh,
        from: addDays(d, 1),
        cooked: d,
        planned: true,
        freezable: true
      };
      lots.push(frozen);
      lot.frozenLot = frozen;
    }
    plannedLots.set(d, lot);
    return lot;
  }

  // 세션별 "먹일 수 있는 기간"과 냉장/냉동 나눔 제안
  for (const s of sessions) {
    const lot = plannedLots.get(s.date);
    if (!lot) continue;
    const frozen = lot.frozenLot;
    const served = [...(lot.served || []), ...((frozen && frozen.served) || [])].sort();
    s.servedFrom = served[0] || null;
    s.servedTo = served[served.length - 1] || null;
    s.servedCount = served.length;
    s.split = {
      fridge: settings.childMealsPerSet - (frozen ? settings.childMealsPerSet - 1 : 0),
      freezer: frozen ? settings.childMealsPerSet - 1 : 0,
      leftover: lot.leftover || 0
    };
    s.unusedAtEnd = lot.remaining + (frozen ? frozen.remaining : 0);
  }

  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    horizon: { start, end },
    sessions: sessions.filter((s) => s.date >= start && s.date <= end),
    meals,
    warnings
  };
}
