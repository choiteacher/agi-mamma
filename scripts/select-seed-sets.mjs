// day-sets.json(로컬, git 제외)에서 앱에 넣을 "하루 식단 세트" 후보를 고른다. (내 PC에서만)
//
//   node scripts/select-seed-sets.mjs [--per-month 15]
//
// - 세트는 통째로만 고른다(요리를 빼거나 섞지 않음).
// - 쉬운 순으로 고르되, 어려운 요리(튀김·전·만두 등)가 2개 이상인 세트는 제외(세션당 난이도 3 이상 최대 1개).
// - 같은 대표 요리가 겹치는 세트는 하나만, 단백질 종류와 센터가 한쪽으로 몰리지 않게 고른다.
// 결과: scripts/output/selected-sets.json (git 제외). 이 목록으로 src/data/menu-sets.seed.json 을 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const perMonth = Number(process.argv[process.argv.indexOf('--per-month') + 1]) || 15;
const { sets } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed-input', 'day-sets.json'), 'utf8'));

export const PROTEINS = [
  ['소고기', /소고기|쇠고기|쇠|한우|우육|소불고기|장조림/],
  ['돼지고기', /돼지|돈육|돈사태|돈수육|돈가스|돈까스|제육|목살|보쌈|수육|폭찹|베이컨|햄/],
  ['닭고기', /닭|치킨|계육/],
  ['생선', /고등어|삼치|생선|명태|북어|황태|동태|코다리|가자미|연어|참치|임연수|갈치|조기/],
  ['해산물', /오징어|새우|어묵|홍합|조개|바지락|굴|게살|맛살/],
  ['두부·달걀', /두부|달걀|계란|메추리알|유부/]
];
const proteinOf = (s) => {
  const names = s.dishes.map((d) => d.name).join(' ');
  return (PROTEINS.find(([, re]) => re.test(names)) || ['채소'])[0];
};
const mainDish = (s) => [...s.dishes].filter((d) => d.role === 'dish').sort((a, b) => b.effort - a.effort)[0]?.name || '';

const out = [];
for (const month of ['2025-10', '2025-11']) {
  const pool = sets.filter((s) => s.refMonth === month && s.hardCount <= 1 && s.dishes.some((d) => d.role === 'dish'));
  const picked = [];
  const usedMain = new Set();
  const proteinCount = {};
  const centerCount = {};
  // 쉬운 순서는 build-day-sets.mjs 에서 이미 정렬됨. 같은 조건이면 단백질/센터가 덜 나온 쪽을 먼저.
  while (picked.length < perMonth) {
    const next = pool
      .filter((s) => !picked.includes(s) && !usedMain.has(mainDish(s)))
      .map((s, i) => ({ s, score: i + 6 * (proteinCount[proteinOf(s)] || 0) + 4 * (centerCount[s.center] || 0) }))
      .sort((a, b) => a.score - b.score)[0];
    if (!next) break;
    const s = next.s;
    picked.push(s);
    usedMain.add(mainDish(s));
    proteinCount[proteinOf(s)] = (proteinCount[proteinOf(s)] || 0) + 1;
    centerCount[s.center] = (centerCount[s.center] || 0) + 1;
  }
  console.log(`\n${month}: ${picked.length}세트  단백질 ${JSON.stringify(proteinCount)}  센터 ${JSON.stringify(centerCount)}`);
  picked.forEach((s) => console.log(`  ${s.id}\t[${proteinOf(s)}] ${s.dishes.map((d) => d.name).join(' / ')}`));
  out.push(...picked.map((s) => ({ ...s, protein: proteinOf(s) })));
}

const dishNames = [...new Set(out.flatMap((s) => s.dishes.filter((d) => d.role !== 'base').map((d) => d.name)))].sort((a, b) =>
  a.localeCompare(b, 'ko')
);
console.log(`\n레시피가 필요한 요리(밥/우유/과일 제외, 김치 포함) ${dishNames.length}개:\n${dishNames.join(', ')}`);
fs.mkdirSync(path.join(ROOT, 'scripts', 'output'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'scripts', 'output', 'selected-sets.json'), JSON.stringify({ sets: out, dishNames }, null, 2));
