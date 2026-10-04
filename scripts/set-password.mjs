// 사이트 비밀번호 설정: npm run set-password
// 비밀번호는 화면에 보이지 않게 입력받고, src/config/gate.json 에 {salt, iterations, hash} 만 저장한다.
// 비밀번호 자체는 어디에도 저장하거나 출력하지 않는다.
//
// 옵션
//   --out <경로>        저장 위치 (기본: src/config/gate.json, 테스트용)
//   --iterations <수>   PBKDF2 반복 횟수 (기본 600000, 최소 310000)
// 터미널이 아닌 표준입력(파이프)으로 실행하면 첫 줄을 비밀번호, 둘째 줄을 확인값으로 읽는다(자동 테스트용).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ITERATIONS, MIN_ITERATIONS, SHORT_PASSWORD_LENGTH, hashPassword } from './lib/gateHash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const outPath = path.resolve(ROOT, argValue('--out') || 'src/config/gate.json');
const iterations = argValue('--iterations') ? Number(argValue('--iterations')) : DEFAULT_ITERATIONS;

if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) {
  console.error(`반복 횟수는 ${MIN_ITERATIONS} 이상의 정수여야 합니다.`);
  process.exit(1);
}

// 터미널에서 입력을 가린다(글자마다 * 표시).
function readHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk) => {
      // 방향키 등 제어 시퀀스는 무시한다.
      if (chunk.startsWith('\u001b')) return;
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish();
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n취소했습니다.\n');
          process.exit(130);
        }
        if (ch === '\b' || ch === '\u007f') {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join('');
            stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function readPiped() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  const lines = data.split(/\r?\n/);
  return [lines[0] || '', lines[1] ?? lines[0] ?? ''];
}

async function main() {
  let password;
  let confirm;
  if (process.stdin.isTTY) {
    password = await readHidden('새 비밀번호: ');
    confirm = await readHidden('한 번 더 입력: ');
  } else {
    [password, confirm] = await readPiped();
  }

  if (!password) {
    console.error('비밀번호가 비어 있습니다. 다시 실행하세요.');
    process.exit(1);
  }
  if (password !== confirm) {
    console.error('두 번 입력한 비밀번호가 다릅니다. 다시 실행하세요.');
    process.exit(1);
  }
  if (Array.from(password).length < SHORT_PASSWORD_LENGTH) {
    console.warn(
      `\n[경고] 비밀번호가 ${SHORT_PASSWORD_LENGTH}자보다 짧습니다.\n` +
        '  gate.json(해시)은 공개 저장소에 올라가므로, 짧은 비밀번호는 오프라인에서 빠르게 풀릴 수 있습니다.\n' +
        '  그대로 진행합니다. 더 길게 바꾸려면 이 명령을 다시 실행하세요.\n'
    );
  }

  const replaced = fs.existsSync(outPath);
  const gate = hashPassword(password, { iterations });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2) + '\n', 'utf8');

  console.log(`저장 완료: ${path.relative(ROOT, outPath)} (반복 ${iterations}회)`);
  if (replaced) console.log('기존 비밀번호를 바꿨습니다. 이미 열어 둔 기기도 다음 방문 때 새 비밀번호를 입력해야 합니다.');
}

main();
