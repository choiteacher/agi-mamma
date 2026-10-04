import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { verifyPassword } from '../../src/gate/crypto';

const SCRIPT = fileURLToPath(new URL('../set-password.mjs', import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agi-gate-'));
const out = path.join(tmpDir, 'gate.json');

// 표준입력(파이프)으로 실행. 실제 gate.json은 건드리지 않고 임시 폴더에만 쓴다.
const run = (input, extra = []) =>
  spawnSync(process.execPath, [SCRIPT, '--out', out, '--iterations', '310000', ...extra], { input, encoding: 'utf8' });

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('npm run set-password', () => {
  it('gate.json을 만들고, 출력과 파일 어디에도 비밀번호가 없다', async () => {
    const pw = 'test-only-long-passphrase';
    const result = run(`${pw}\n${pw}\n`);
    expect(result.status).toBe(0);
    const gate = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(Object.keys(gate).sort()).toEqual(['hash', 'iterations', 'salt']);
    expect(await verifyPassword(pw, gate)).toBe(true);
    expect(result.stdout + result.stderr + fs.readFileSync(out, 'utf8')).not.toContain(pw);
    expect(result.stderr).not.toContain('경고');
  });

  it('8자 미만이면 공개 해시 위험을 경고하지만 진행한다', () => {
    const result = run('short1\nshort1\n');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('오프라인에서 빠르게 풀릴 수 있습니다');
    expect(fs.existsSync(out)).toBe(true);
  });

  it('확인값이 다르거나 비어 있으면 저장하지 않는다', () => {
    const before = fs.readFileSync(out, 'utf8');
    expect(run('aaaaaaaa1\naaaaaaaa2\n').status).toBe(1);
    expect(run('\n\n').status).toBe(1);
    expect(fs.readFileSync(out, 'utf8')).toBe(before);
  });

  it('반복 횟수가 310000 미만이면 거부한다', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out, '--iterations', '1000'], { input: 'x\nx\n', encoding: 'utf8' });
    expect(r.status).toBe(1);
  });

  it('node가 실행 가능하다(환경 확인)', () => {
    expect(execFileSync(process.execPath, ['-e', 'console.log(1)'], { encoding: 'utf8' }).trim()).toBe('1');
  });
});
