// 저장소 밖 비밀키 파일 읽기. 값은 절대 출력/로그/파일에 남기지 않는다.
// 기본 위치: <홈>/.agi-pig-secrets/.env  (환경변수 SECRETS_PATH 로 변경 가능)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const secretsPath = () => process.env.SECRETS_PATH || path.join(os.homedir(), '.agi-pig-secrets', '.env');

let cache = null;

function load() {
  if (cache) return cache;
  cache = {};
  let text;
  try {
    text = fs.readFileSync(secretsPath(), 'utf8');
  } catch {
    return cache;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    cache[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return cache;
}

// 없으면 이름만 알려주고 종료한다.
export function requireSecret(name) {
  const value = load()[name];
  if (!value) {
    console.error(`비밀키 ${name} 를 찾을 수 없습니다. 저장소 밖 비밀키 파일(.agi-pig-secrets/.env)에 ${name}=... 줄을 넣어 주세요.`);
    process.exit(1);
  }
  return value;
}

export function hasSecret(name) {
  return !!load()[name];
}

// 키 이름 → 값 묶음 (값은 이 프로세스 메모리에만 둔다)
export function loadSecrets() {
  return { ...load() };
}
