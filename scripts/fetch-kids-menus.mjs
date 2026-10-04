// 어린이급식관리지원센터(식약처 dietary4u.mfds.go.kr) 월간 유아 식단 자료 내려받기 (내 PC에서만 실행)
//
//   node scripts/fetch-kids-menus.mjs [--month 2025-10] [--month 2025-11]
//
// - 공개 게시판의 첨부 엑셀(유치원/3~5세 표준레시피, 영양성분표)만 받는다.
// - 원본 파일은 git에서 제외되는 data/seed-input/raw/ 에만 저장한다. 저장소/웹 번들에는 넣지 않는다.
// - 각 센터 사이트에는 공공누리 표시 없이 "All rights reserved"만 있어 재배포 조건이 확인되지 않았다.
//   그래서 요리명만 참고하고, 조리법 문장은 모두 새로 쓴다.
// - 요청 사이에 지연을 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RAW_DIR = path.join(ROOT, 'data', 'seed-input', 'raw');
const BASE = 'https://dietary4u.mfds.go.kr';
const DELAY_MS = 1000;

// 센터별 게시글(list_no)과 첨부 순번(seq). 게시판에서 직접 확인한 값 (2026-10-04 기준)
export const SOURCES = [
  {
    center: 'gangdong',
    label: '서울 강동구 어린이급식관리지원센터',
    mid: 'aq0205010000',
    bid: 'AQ01',
    kind: 'nutrition', // 식단 영양성분표 (날짜별 메뉴)
    posts: { '2025-10': { listNo: 112025, seq: 4 }, '2025-11': { listNo: 115047, seq: 3 } }
  },
  {
    center: 'wonju',
    label: '강원 원주시 어린이급식관리지원센터',
    mid: 'jb0201010000',
    bid: 'JB01',
    kind: 'recipe', // 유치원 표준레시피
    posts: { '2025-10': { listNo: 113039, seq: 4 }, '2025-11': { listNo: 115939, seq: 4 } }
  },
  {
    center: 'jincheon',
    label: '충북 진천군 어린이급식관리지원센터',
    mid: 'kj0201000000',
    bid: 'KJ01',
    kind: 'recipe', // 일반형 3~5세 표준레시피
    posts: { '2025-10': { listNo: 117526, seq: 2 }, '2025-11': { listNo: 117538, seq: 2 } }
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (agi-mamma seed collector; personal use)';

async function download(src, month) {
  const { listNo, seq } = src.posts[month];
  const viewUrl = `${BASE}/board.es?mid=${src.mid}&bid=${src.bid}&act=view&list_no=${listNo}`;
  // 게시글을 먼저 열어 세션 쿠키를 받은 뒤, 그 글을 참조로 첨부를 받는다(사이트가 직접 접근을 막음).
  const view = await fetch(viewUrl, { headers: { 'User-Agent': UA } });
  const cookie = (view.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  await view.text();
  await sleep(DELAY_MS);
  const res = await fetch(`${BASE}/boardDownload.es?mid=${src.mid}&bid=${src.bid}&list_no=${listNo}&seq=${seq}`, {
    headers: { 'User-Agent': UA, Referer: viewUrl, Cookie: cookie }
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 2).toString() !== 'PK') throw new Error(`${src.label} ${month}: 엑셀 파일이 아닌 응답 (${buf.length}바이트)`);
  const out = path.join(RAW_DIR, src.center, `${month}.xlsx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`받음: ${src.label} ${month} → ${path.relative(ROOT, out)} (${Math.round(buf.length / 1024)}KB)`);
  await sleep(DELAY_MS);
}

async function main() {
  const months = process.argv.flatMap((a, i, all) => (all[i - 1] === '--month' ? [a] : []));
  const targets = months.length ? months : ['2025-10', '2025-11'];
  for (const src of SOURCES) {
    for (const month of targets) {
      if (!src.posts[month]) {
        console.log(`건너뜀: ${src.label} ${month} (게시글 정보 없음 - SOURCES에 추가 필요)`);
        continue;
      }
      await download(src, month);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
