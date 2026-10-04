// 앱 시드 데이터 생성 (내 PC에서만)
//
//   node scripts/select-seed-sets.mjs   # 먼저 세트 선택 (scripts/output/selected-sets.json)
//   node scripts/build-seed.mjs         # src/data/recipes.seed.json, src/data/menu-sets.seed.json 생성
//
// - 세트는 센터 표준식단의 하루 끼니를 그대로 옮긴다(요리 이름만). 요리를 빼거나 섞지 않는다.
// - 레시피 문장/계량은 scripts/seed/recipe-texts-*.mjs 에서 새로 쓴 것을 쓴다(성인 약 5인분).
// - 근거 없는 수치(보관일수, 영양, 월령)는 null 로 두고 화면에 "확인 필요"로 표시한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOUPS } from './seed/recipe-texts-1.mjs';
import { DISHES } from './seed/recipe-texts-2.mjs';
import { excludedReason, isKimchi } from './lib/dishRules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = '어린이급식관리지원센터 표준식단의 요리명 참고 (조리법은 새로 작성)';
const SOURCE_URL = 'https://dietary4u.mfds.go.kr/';
const SERVINGS = 5;

// 원래 매운 요리를 안 매운 방법으로 바꿔 쓴 레시피
const MILD_VERSION = new Set([
  'mild-pork-potato-soup',
  'mild-andong-jjimdak',
  'pumpkin-chicken-galbi',
  'cheese-chicken-galbi',
  'squid-veg-stirfry',
  'mild-braised-chicken',
  'braised-mackerel-radish',
  'washed-kimchi-pork-stirfry',
  'kimchi-tuna-stew'
]);

const BASE_TIP = {
  밥: '소분해 냉동해 둔 밥을 데워 주세요.',
  과일: '아이 한입 크기로 잘라 주세요.'
};

const texts = [...SOUPS, ...DISHES];
const ids = new Set();
for (const t of texts) {
  if (ids.has(t.id)) throw new Error(`레시피 id 중복: ${t.id}`);
  ids.add(t.id);
}
const byName = new Map();
for (const t of texts) for (const n of [t.name, ...(t.aliases || [])]) byName.set(n, t);

const { sets: selected } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'output', 'selected-sets.json'), 'utf8'));

const missing = new Set();
const firstSet = new Map();
const sets = selected.map((s) => {
  const dishes = s.dishes.map((d) => {
    const reason = excludedReason(d.name);
    if (reason) {
      return { name: d.name, role: 'base', recipe_id: null, note: reason.startsWith('밥') ? BASE_TIP.밥 : BASE_TIP.과일 };
    }
    const t = byName.get(d.name);
    if (!t) {
      missing.add(d.name);
      return null;
    }
    if (!firstSet.has(t.id)) firstSet.set(t.id, s.id);
    const role = isKimchi(d.name) && t.id === 'washed-kimchi' ? 'kimchi' : 'dish';
    const note = role === 'kimchi' ? '물에 헹궈 씻어서' : MILD_VERSION.has(t.id) ? '안 매운 버전' : null;
    return { name: d.name, role, recipe_id: t.id, note };
  });
  const cooked = dishes.filter((d) => d && d.role === 'dish').map((d) => byName.get(d.name));
  return {
    id: s.id,
    ref_month: s.refMonth,
    month: Number(s.refMonth.slice(5)),
    slot: s.slot,
    source: s.centerLabel,
    protein: s.protein,
    dishes,
    difficulty_max: Math.max(1, ...cooked.map((t) => t.diff)),
    hard_count: cooked.filter((t) => t.diff >= 3).length,
    active_minutes: cooked.reduce((a, t) => a + t.min, 0),
    freezable: cooked.length > 0 && cooked.some((t) => t.freeze),
    all_freezable: cooked.length > 0 && cooked.every((t) => t.freeze)
  };
});
if (missing.size) {
  console.error(`레시피가 없는 요리: ${[...missing].join(', ')}`);
  process.exit(1);
}

const parseIngredients = (s) =>
  s.split(';').map((part) => {
    const p = part.trim();
    // 마지막 공백 뒤가 양(숫자/분수/'약간' 등)이면 분리
    const m = p.match(/^(.*\S)\s+((?:[\d./]+|약간|적당량|한|조금)[^\s]*(?:\s?\S*)?)$/);
    return m && /[\d약적한조]/.test(m[2]) ? { item: m[1], amount: m[2] } : { item: p, amount: '' };
  });

const used = new Set(sets.flatMap((s) => s.dishes.filter((d) => d.recipe_id).map((d) => d.recipe_id)));
const recipes = texts
  .filter((t) => used.has(t.id))
  .map((t) => ({
    id: t.id,
    name: t.name,
    aliases: t.aliases || [],
    category: t.cat,
    difficulty: t.diff,
    active_minutes: t.min,
    servings: SERVINGS,
    ingredients: parseIngredients(t.ing),
    steps_short: t.short,
    steps_full: t.full,
    batch_group: firstSet.get(t.id),
    mild_version: MILD_VERSION.has(t.id),
    freezable: t.freeze,
    portion_count: SERVINGS,
    fridge_days: null,
    freezer_days: null,
    min_age_months: null,
    safety_note: t.safety,
    source: SOURCE,
    source_url: SOURCE_URL,
    verified: false
  }));

const unused = texts.filter((t) => !used.has(t.id)).map((t) => t.name);
const outDir = path.join(ROOT, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'recipes.seed.json'), JSON.stringify(recipes, null, 2) + '\n');
fs.writeFileSync(
  path.join(outDir, 'menu-sets.seed.json'),
  JSON.stringify(
    {
      note: '어린이급식관리지원센터 월간 표준식단(작년 같은 달)의 하루 끼니 구성을 요리 이름만 옮긴 것. 세트 단위로만 사용한다.',
      servings: SERVINGS,
      sets
    },
    null,
    2
  ) + '\n'
);
console.log(`레시피 ${recipes.length}개, 세트 ${sets.length}개 생성 (verified:false ${recipes.length}개)`);
console.log('근거 없어 비워 둔 필드: fridge_days, freezer_days, min_age_months (모든 레시피)');
if (unused.length) console.log(`세트에 쓰이지 않아 제외한 원고: ${unused.join(', ')}`);
