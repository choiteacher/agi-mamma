// NEIS 급식 데이터에서 요리명 후보를 모은다. (내 PC에서만 실행, 인증키는 저장소 밖 .agi-pig-secrets/.env 의 NEIS_API_KEY)
//
//   node scripts/fetch-neis-dishes.mjs --survey
//       충남교육청(N10) 유치원 존재 여부 + 급식 데이터 유무 확인, 대안(초등학교) 데이터 현황 요약
//   node scripts/fetch-neis-dishes.mjs --find <학교명 일부>
//       학교 코드 찾기
//   node scripts/fetch-neis-dishes.mjs --collect --schools <코드,코드> [--months 3] [--to YYYYMMDD] [--out-home]
//       최근 N개월 급식에서 요리명을 추출해 빈도순 목록 생성
//       결과: data/seed-input/dishes.txt (git 제외) / --out-home 이면 <홈>/.agi-pig-secrets/neis-dishes.txt
//
// 지켜야 할 것
// - 인증키와 인증키가 들어간 URL은 출력하지 않는다.
// - NEIS 원문(식단표 전체)은 저장하지 않는다. 요리명 집계 결과만 저장한다.
// - 출처: 교육부·시도교육청, 나이스 교육정보 개방 포털(open.neis.go.kr). 이용약관 제11조(출처 표시 조건 자유이용).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireSecret } from './lib/secrets.mjs';
import { neisGetAll, isTrafficLimit, callCount } from './lib/neis.mjs';
import { splitDishes, excludedReason, spicyInfo, cautionsFor, isKimchi } from './lib/dishRules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFICE = 'N10'; // 충청남도교육청
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function run(fn) {
  try {
    await fn();
  } catch (e) {
    if (isTrafficLimit(e)) {
      console.error('\nNEIS 일일 트래픽 제한에 걸렸습니다. 오늘은 더 호출하지 말고 내일 다시 실행하세요.');
    } else {
      console.error('\n오류:', e.message);
    }
    process.exit(1);
  } finally {
    console.log(`(NEIS 호출 ${callCount}회)`);
  }
}

// ---------------------------------------------------------------- survey
async function survey(key) {
  const schools = await neisGetAll(key, 'schoolInfo', { ATPT_OFCDC_SC_CODE: OFFICE });
  const kinder = schools.filter((s) => /유치원/.test(s.SCHUL_KND_SC_NM) || /유치원/.test(s.SCHUL_NM));
  const publicKinder = kinder.filter((s) => s.FOND_SC_NM === '공립');
  console.log(`\n[1] 학교기본정보(schoolInfo) - ${schools[0]?.ATPT_OFCDC_SC_NM ?? OFFICE}`);
  console.log(`    전체 ${schools.length}곳 / 유치원 ${kinder.length}곳 / 공립유치원 ${publicKinder.length}곳`);

  const kinderWithMeals = [];
  const to = addDays(today(), -1);
  const from = addDays(to, -90);
  for (const k of publicKinder) {
    const rows = await neisGetAll(key, 'mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: OFFICE,
      SD_SCHUL_CODE: k.SD_SCHUL_CODE,
      MLSV_FROM_YMD: ymd(from),
      MLSV_TO_YMD: ymd(to)
    });
    if (rows.length) kinderWithMeals.push({ code: k.SD_SCHUL_CODE, name: k.SCHUL_NM, days: rows.length });
  }
  if (publicKinder.length) console.log(`    급식 데이터가 있는 공립유치원: ${kinderWithMeals.length}곳`);

  // 대안: 초등학교 급식 데이터 현황. 급식 조회는 학교 코드가 필수라서 교육지원청마다 공립 초등학교 2곳씩 표본 확인한다.
  const elementary = schools.filter((s) => s.SCHUL_KND_SC_NM === '초등학교' && s.FOND_SC_NM === '공립');
  const byOrg = new Map();
  for (const s of elementary) byOrg.set(s.JU_ORG_NM, [...(byOrg.get(s.JU_ORG_NM) || []), s]);
  const sample = [...byOrg.values()].flatMap((list) => list.slice(0, 2));
  const sampleResults = [];
  const mealKinds = new Set();
  for (const s of sample) {
    const rows = await neisGetAll(key, 'mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: OFFICE,
      SD_SCHUL_CODE: s.SD_SCHUL_CODE,
      MLSV_FROM_YMD: ymd(from),
      MLSV_TO_YMD: ymd(to)
    });
    rows.forEach((r) => mealKinds.add(r.MMEAL_SC_NM));
    sampleResults.push({ code: s.SD_SCHUL_CODE, name: s.SCHUL_NM, office: s.JU_ORG_NM, meals: rows.length });
  }
  const withData = sampleResults.filter((r) => r.meals > 0);
  console.log(`
[2] 대안 확인: 공립 초등학교 급식식단정보 (${ymd(from)} ~ ${ymd(to)}, 교육지원청별 2곳 표본)`);
  console.log(`    공립 초등학교 ${elementary.length}곳 중 표본 ${sample.length}곳 → 급식 데이터 있음 ${withData.length}곳`);
  console.log(
    `    표본 평균 급식 수: ${withData.length ? Math.round(withData.reduce((a, r) => a + r.meals, 0) / withData.length) : 0}끼 / 식사 구분: ${[...mealKinds].join(', ') || '-'}`
  );

  const outDir = path.join(ROOT, 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'neis-survey.json');
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        office: OFFICE,
        schoolCount: schools.length,
        kindergartenCount: kinder.length,
        publicKindergartenCount: publicKinder.length,
        kindergartensWithMeals: kinderWithMeals,
        elementarySample: sampleResults
      },
      null,
      2
    )
  );
  console.log(`\n저장: ${path.relative(ROOT, out)} (git 제외 폴더, 학교 공개정보만)`);
}

// ---------------------------------------------------------------- survey-all
// 전국 17개 시도교육청에서 유치원(학교 종류 또는 이름에 "유치원")이 있는지 확인한다.
export const OFFICES = {
  B10: '서울',
  C10: '부산',
  D10: '대구',
  E10: '인천',
  F10: '광주',
  G10: '대전',
  H10: '울산',
  I10: '세종',
  J10: '경기',
  K10: '강원',
  M10: '충북',
  N10: '충남',
  P10: '전북',
  Q10: '전남',
  R10: '경북',
  S10: '경남',
  T10: '제주'
};

async function surveyAll(key) {
  const kinds = new Set();
  const found = [];
  for (const [code, name] of Object.entries(OFFICES)) {
    const schools = await neisGetAll(key, 'schoolInfo', { ATPT_OFCDC_SC_CODE: code });
    schools.forEach((s) => kinds.add(s.SCHUL_KND_SC_NM));
    const kinder = schools.filter((s) => /유치원/.test(s.SCHUL_KND_SC_NM) || /유치원/.test(s.SCHUL_NM));
    console.log(
      `${code} ${name}: 학교 ${schools.length}곳 / 유치원 ${kinder.length}곳 (공립 ${kinder.filter((s) => s.FOND_SC_NM === '공립').length})`
    );
    found.push(
      ...kinder.map((s) => ({ office: code, code: s.SD_SCHUL_CODE, name: s.SCHUL_NM, kind: s.SCHUL_KND_SC_NM, fond: s.FOND_SC_NM }))
    );
  }
  console.log('\n학교 종류 전체:', [...kinds].sort().join(', '));
  console.log(`전국 유치원 ${found.length}곳`);

  // 공립 유치원이 있으면 최근 3개월 급식 데이터 유무를 확인한다(최대 10곳).
  const to = addDays(today(), -1);
  const from = addDays(to, -90);
  const checked = [];
  for (const k of found.filter((s) => s.fond === '공립').slice(0, 10)) {
    const rows = await neisGetAll(key, 'mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: k.office,
      SD_SCHUL_CODE: k.code,
      MLSV_FROM_YMD: ymd(from),
      MLSV_TO_YMD: ymd(to)
    });
    checked.push({ ...k, meals: rows.length });
    console.log(`  ${k.office}:${k.code} ${k.name} → 급식 ${rows.length}끼`);
  }

  const outDir = path.join(ROOT, 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'neis-survey-all.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), kinds: [...kinds], kindergartens: found, checked }, null, 2)
  );
  console.log('\n저장: scripts/output/neis-survey-all.json');
}

// ---------------------------------------------------------------- find
async function find(key, word) {
  const schools = await neisGetAll(key, 'schoolInfo', { ATPT_OFCDC_SC_CODE: OFFICE, SCHUL_NM: word });
  for (const s of schools) console.log(`${s.SD_SCHUL_CODE}\t${s.SCHUL_NM}\t${s.SCHUL_KND_SC_NM}\t${s.JU_ORG_NM}`);
  if (!schools.length) console.log('찾은 학교가 없습니다.');
}

// ---------------------------------------------------------------- collect
const groupKey = (name) => name.replace(/\s+/g, '').replace(/쇠고기/g, '소고기');

async function collect(key, codes, months, toYmd, outHome) {
  const to = toYmd ? new Date(Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(4, 6) - 1, +toYmd.slice(6, 8))) : addDays(today(), -1);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - months, to.getUTCDate() + 1));
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    console.warn('주의: 급식식단정보는 "현재년도" 데이터를 제공한다고 안내되어 있어, 작년 기간은 비어 있을 수 있습니다.');
  }

  const dishes = new Map(); // groupKey → { names: Map(name→count), count, schools:Set }
  const schoolNames = [];
  let mealDays = 0;
  for (const code of codes) {
    const rows = await neisGetAll(key, 'mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: OFFICE,
      SD_SCHUL_CODE: code,
      MLSV_FROM_YMD: ymd(from),
      MLSV_TO_YMD: ymd(to)
    });
    schoolNames.push(`${rows[0]?.SCHUL_NM ?? code}(${rows.length}끼)`);
    mealDays += rows.length;
    for (const row of rows) {
      for (const name of splitDishes(row.DDISH_NM)) {
        const k = groupKey(name);
        const entry = dishes.get(k) || { names: new Map(), count: 0, schools: new Set() };
        entry.count += 1;
        entry.names.set(name, (entry.names.get(name) || 0) + 1);
        entry.schools.add(code);
        dishes.set(k, entry);
      }
    }
  }

  const list = [...dishes.values()]
    .map((e) => {
      const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0][0];
      return { name, count: e.count, schools: e.schools.size };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  const main = [];
  const kimchi = [];
  const excluded = [];
  for (const d of list) {
    const reason = excludedReason(d.name);
    if (reason) excluded.push({ ...d, reason });
    else if (isKimchi(d.name)) kimchi.push(d);
    else main.push(d);
  }

  const lines = [];
  lines.push('# NEIS 급식 요리명 후보 (공공 급식 데이터의 요리명 참고)');
  lines.push(`# 출처: 교육부·충청남도교육청, 나이스 교육정보 개방 포털 급식식단정보 (open.neis.go.kr)`);
  lines.push(`# 기간: ${ymd(from)} ~ ${ymd(to)} / 학교: ${schoolNames.join(', ')} / 급식 ${mealDays}끼`);
  lines.push(`# 생성: ${new Date().toISOString()}`);
  lines.push('# "주의"는 요리명만 보고 붙인 일반적인 표시입니다. 최종 판단은 부모가 합니다.');
  lines.push('# 매운 요리는 "안 매운 대체안"을 제안합니다. 김치류는 대체안을 만들지 않습니다.');
  lines.push('# 고를 요리 앞의 [ ] 를 [x] 로 바꿔 주세요. 대체안으로 쓰고 싶으면 [m] 으로 표시하세요.');
  lines.push('');
  lines.push('## 후보');
  lines.push('선택\t순위\t요리명\t등장\t학교수\t34개월 주의\t안 매운 대체안');
  main.forEach((d, i) => {
    const caution = cautionsFor(d.name).join(', ') || '-';
    const mild = spicyInfo(d.name).mild || '-';
    lines.push(`[ ]\t${i + 1}\t${d.name}\t${d.count}\t${d.schools}\t${caution}\t${mild}`);
  });
  lines.push('');
  lines.push('## 김치류 (안 매운 대체안 없음)');
  kimchi.forEach((d) => lines.push(`[ ]\t-\t${d.name}\t${d.count}\t${d.schools}\t김치류\t-`));
  lines.push('');
  lines.push('## 일정 대상 아님 (음료/과일/밥) - 참고용');
  excluded.forEach((d) => lines.push(`\t-\t${d.name}\t${d.count}\t${d.schools}\t${d.reason}\t-`));

  const out = outHome
    ? path.join(os.homedir(), '.agi-pig-secrets', 'neis-dishes.txt')
    : path.join(ROOT, 'data', 'seed-input', 'dishes.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');

  const spicyCount = main.filter((d) => spicyInfo(d.name).level === 'spicy').length;
  console.log(`\n급식 ${mealDays}끼, 서로 다른 요리 ${list.length}개`);
  console.log(`후보 ${main.length}개 (매운 요리 ${spicyCount}개는 대체안 표시) / 김치류 ${kimchi.length}개 / 제외 ${excluded.length}개`);
  console.log(`저장: ${outHome ? '<홈>/.agi-pig-secrets/neis-dishes.txt' : path.relative(ROOT, out)}`);
}

// ---------------------------------------------------------------- main
const key = requireSecret('NEIS_API_KEY');
if (has('--survey-all')) await run(() => surveyAll(key));
else if (has('--survey')) await run(() => survey(key));
else if (has('--find')) await run(() => find(key, opt('--find')));
else if (has('--collect')) {
  const codes = (opt('--schools') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!codes.length) {
    console.error('--schools 코드1,코드2 를 지정하세요. (코드는 --find 로 찾을 수 있습니다)');
    process.exit(1);
  }
  await run(() => collect(key, codes, Number(opt('--months') || 3), opt('--to'), has('--out-home')));
} else {
  console.log('사용법: --survey | --find <학교명> | --collect --schools <코드,...> [--months 3] [--to YYYYMMDD] [--out-home]');
}
