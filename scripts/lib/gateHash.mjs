// 비밀번호 → gate.json 값 계산. 브라우저 검증(src/gate/crypto.js)과 같은 방식이어야 한다:
// PBKDF2-HMAC-SHA256, 비밀번호는 NFC 정규화 후 UTF-8, 결과 32바이트, salt/hash는 base64.
import crypto from 'node:crypto';

export const MIN_ITERATIONS = 310000;
// OWASP Password Storage Cheat Sheet 권장값 (PBKDF2-HMAC-SHA256: 600,000회)
export const DEFAULT_ITERATIONS = 600000;
export const SHORT_PASSWORD_LENGTH = 8;

export function hashPassword(password, { iterations = DEFAULT_ITERATIONS, salt = crypto.randomBytes(16) } = {}) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) {
    throw new Error(`반복 횟수는 ${MIN_ITERATIONS} 이상이어야 합니다.`);
  }
  const hash = crypto.pbkdf2Sync(Buffer.from(password.normalize('NFC'), 'utf8'), salt, iterations, 32, 'sha256');
  return { salt: salt.toString('base64'), iterations, hash: hash.toString('base64') };
}
