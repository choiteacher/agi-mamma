// 비밀번호 화면의 검증 로직 (WebCrypto PBKDF2-SHA256).
// 이 화면은 클라이언트에서만 동작하는 "문고리"이며 진짜 보안이 아니다(README 참고).
// scripts/lib/gateHash.mjs 와 같은 방식(UTF-8, NFC 정규화, 32바이트 결과)으로 계산해야 한다.

export const MIN_ITERATIONS = 310000;

const base64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export const isCryptoAvailable = () => typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle;

export const isValidGate = (gate) =>
  !!gate &&
  typeof gate.salt === 'string' &&
  typeof gate.hash === 'string' &&
  Number.isInteger(gate.iterations) &&
  gate.iterations >= MIN_ITERATIONS;

export async function derivePasswordHash(password, saltB64, iterations) {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(saltB64), iterations }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

// 길이가 같으면 끝까지 비교한다(조기 종료로 인한 시간 차이를 줄이기 위한 습관적 처리).
const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function verifyPassword(password, gate) {
  if (!password || !isValidGate(gate)) return false;
  const hash = await derivePasswordHash(password, gate.salt, gate.iterations);
  return safeEqual(hash, gate.hash);
}
