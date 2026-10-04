// 어린이급식관리지원센터 표준식단을 "하루 식단 세트" 단위로 정리한다. (내 PC에서만)
//
//   node scripts/build-day-sets.mjs
//
// 원칙: 표준식단은 그날 그 끼니의 요리를 함께 먹어야 영양이 맞도록 짜여 있다.
//       그래서 요리를 낱개로 고르거나 다른 날 요리와 섞지 않고, 세트를 통째로 다룬다.
//       세트 안에서 바꾸는 것은 사용자 지침뿐이다: 매운 요리 → 안 매운 버전, 김치 → 씻어서.
// 결과: data/seed-input/day-sets.json (+ 사람이 읽는 day-sets.txt), git 제외 폴더
//       요리명만 담는다. 원본 엑셀의 재료량, 조리법 문장, 영양 수치는 저장하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOURCES, RAW_DIR } from './fetch-kids-menus.mjs';
import { readMenuEntries } from './lib/kidsMenu.mjs';
import { cautionsFor, cookEffort, excludedReason, isKimchi, spicyInfo } from './lib/dishRules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'seed-input');
const MONTHS = ['2025-10', '2025-11'];
const MEAL_SLOTS = ['점심', '저녁'];

const sets = [];
for (const src of SOURCES) {
  for (const month of MONTHS) {
    const file = path.join(RAW_DIR, src.center, `${month}.xlsx`);
    if (!fs.existsSync(file)) {
      console.warn(`없음: ${path.relative(ROOT, file)} (먼저 node scripts/fetch-kids-menus.mjs 실행)`);
      continue;
    }
    const entries = await readMenuEntries(file);
    if (entries.headerMonth && entries.headerMonth !== Number(month.slice(5))) {
      throw new Error(`${src.label} ${month}: 파일 머리말의 달(${entries.headerMonth}월)이 다릅니다.`);
    }
    const bySet = new Map();
    for (const e of entries) {
      if (!MEAL_SLOTS.includes(e.slot)) continue;
      const key = `${e.day}|${e.slot}`;
      if (!bySet.has(key)) bySet.set(key, []);
      bySet.get(key).push(e.name);
    }
    for (const [key, names] of bySet) {
      const [day, slot] = key.split('|');
      const dishes = names.map((name) => {
        const spicy = spicyInfo(name);
        return {
          name,
          role: excludedReason(name) ? 'base' : isKimchi(name) ? 'kimchi' : 'dish',
          effort: cookEffort(name),
          spicy: spicy.level,
          adjust: spicy.level === 'spicy' || spicy.level === 'kimchi' ? spicy.mild : null,
          cautions: cautionsFor(name)
        };
      });
      const cooked = dishes.filter((d) => d.role === 'dish');
      sets.push({
        id: `${src.center}-${month}-${String(day).padStart(2, '0')}-${slot === '점심' ? 'L' : 'D'}`,
        center: src.center,
        centerLabel: src.label,
        refMonth: month,
        day: Number(day),
        slot,
        dishes,
        effort: dishes.reduce((a, d) => a + d.effort, 0),
        hardCount: cooked.filter((d) => d.effort >= 3).length,
        cookCount: cooked.length
      });
    }
  }
}

// 쉬운 순: 튀김/전 같은 어려운 요리 수 → 총 수고 → 만들 요리 수
const rank = (a, b) => a.hardCount - b.hardCount || a.effort - b.effort || a.cookCount - b.cookCount || a.id.localeCompare(b.id);
sets.sort(rank);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, 'day-sets.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), months: MONTHS, sets }, null, 2) + '\n'
);

const fmt = (d) => {
  let s = d.name;
  if (d.adjust) s += ` → ${d.adjust}`;
  if (d.cautions.length) s += ` [${d.cautions.filter((c) => !c.startsWith('김치')).join(', ') || '김치'}]`;
  return s;
};
const lines = ['# 하루 식단 세트 (어린이급식관리지원센터 표준식단, 세트 그대로 사용)', `# 생성: ${new Date().toISOString()}`, ''];
for (const month of MONTHS) {
  const list = sets.filter((s) => s.refMonth === month);
  lines.push(`## ${month} 기준 (${list.length}세트, 쉬운 순)`);
  list.forEach((s, i) => lines.push(`${i + 1}\t수고 ${s.effort}\t어려운요리 ${s.hardCount}\t${s.id}\t${s.dishes.map(fmt).join(' / ')}`));
  lines.push('');
}
fs.writeFileSync(path.join(OUT_DIR, 'day-sets.txt'), lines.join('\n'), 'utf8');

for (const month of MONTHS) {
  const list = sets.filter((s) => s.refMonth === month);
  const easy = list.filter((s) => s.hardCount === 0);
  console.log(`${month}: 세트 ${list.length}개 (어려운 요리 없는 세트 ${easy.length}개)`);
}
console.log('저장: data/seed-input/day-sets.json, day-sets.txt');
