// 커밋에 비밀값이 들어가는 것을 막는 검사.
//   node scripts/check-secrets.mjs          → 스테이징된 파일 검사 (pre-commit 훅이 호출)
//   node scripts/check-secrets.mjs --all    → git이 추적하거나 추적할 수 있는 모든 파일 검사
// 발견해도 값 자체는 절대 출력하지 않고 "파일:줄"만 알린다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ALL = process.argv.includes('--all');

// Google API 키 형식(AIza + 35자). 검사 스크립트 자신이 걸리지 않도록 패턴을 조립한다.
const GOOGLE_KEY = new RegExp('AI' + 'za[0-9A-Za-z_\\-]{35}');
// 커밋하면 안 되는 경로
const BLOCKED_PATH = [
  { test: (p) => /^\.env/i.test(path.posix.basename(p)), reason: '.env 파일' },
  { test: (p) => p.startsWith('scripts/output/'), reason: '스크립트 결과물(scripts/output)' },
  { test: (p) => p.startsWith('data/seed-input/'), reason: '시드 원본(data/seed-input)' }
];
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|zip|gz|pdf|mp4)$/i;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const files = ALL
  ? git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  : git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
const list = files.split('\0').filter(Boolean);

const problems = [];
for (const file of list) {
  const blocked = BLOCKED_PATH.find((b) => b.test(file));
  if (blocked) {
    problems.push(`${file}: ${blocked.reason}은(는) 커밋할 수 없습니다.`);
    continue;
  }
  if (BINARY_EXT.test(file)) continue;

  let content;
  try {
    // 스테이징 검사는 작업 폴더가 아니라 실제로 커밋될 내용(인덱스)을 읽는다.
    content = ALL ? fs.readFileSync(file, 'utf8') : git(['show', `:${file}`]);
  } catch {
    continue;
  }
  content.split(/\r?\n/).forEach((line, i) => {
    if (GOOGLE_KEY.test(line)) problems.push(`${file}:${i + 1}: Google API 키 형식의 문자열이 있습니다.`);
  });
}

if (problems.length) {
  console.error('\n[check-secrets] 비밀값이 포함될 수 있어 중단합니다.');
  for (const p of problems) console.error('  - ' + p);
  console.error('\n해당 내용을 지우거나 비밀키는 저장소 밖 .agi-pig-secrets/.env 로 옮긴 뒤 다시 시도하세요.\n');
  process.exit(1);
}
console.log(`[check-secrets] ${list.length}개 파일 검사, 문제 없음.`);
