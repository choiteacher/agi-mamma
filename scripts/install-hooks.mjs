// npm install 때 자동 실행(prepare). git 저장소이면 .githooks 폴더를 훅 경로로 등록한다.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  console.log('[install-hooks] git 저장소가 아니어서 훅 등록을 건너뜁니다. git init 후 npm install 을 다시 실행하세요.');
  process.exit(0);
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
console.log('[install-hooks] pre-commit 훅 등록 완료 (core.hooksPath=.githooks)');
