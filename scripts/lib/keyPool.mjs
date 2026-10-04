// Gemini 키 묶음 관리 (내 PC 스크립트 전용)
//
// - 비밀키 파일의 GEMINI_API_KEY_1~3 (없으면 GEMINI_API_KEY 를 1번으로) 을 번호 순서대로 쓴다.
// - 기본은 1번 키만 쓴다. --rotate-keys 일 때만 다음 키로 넘어간다.
//   (Google API 이용약관 2(d)는 사용 한도를 우회하지 말라고 하므로, 여러 계정/프로젝트로 한도를 늘리는 용도로는 쓰지 않는 것을 권장)
// - 일시 오류(분당 한도 429, 5xx): 지수 백오프로 최대 3회 재시도, 그래도 실패하면 (전환 모드에서) 다음 키
// - 일일 한도 소진: 그 키를 "소진"으로 표시하고 바로 다음 키. 24시간 뒤 다시 사용(일일 한도는 태평양 시간 자정에 초기화)
// - 인증 오류(잘못된/만료 키): "무효"로 표시하고 건너뜀
// - 상태는 scripts/output/key-state.json (git 제외)에 키 "번호"로만 저장한다.
// - 로그에는 "key #2" 같은 번호만 쓴다. 키 값이나 그 일부는 절대 출력하지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export const EXHAUSTED_RESET_MS = 24 * 60 * 60 * 1000;

export class AllKeysUnavailableError extends Error {
  constructor(detail) {
    super(`사용할 수 있는 Gemini 키가 없습니다 (${detail}).`);
    this.name = 'AllKeysUnavailableError';
  }
}

export class FatalRequestError extends Error {
  constructor(status, code) {
    super(`요청 오류 (HTTP ${status}${code ? `, ${code}` : ''}) - 키 문제가 아니라 요청 내용 문제입니다.`);
    this.name = 'FatalRequestError';
    this.status = status;
  }
}

// HTTP 상태와 응답 본문으로 오류 종류를 나눈다.
// 공식 문서: 429 rate_limit_exceeded(분당) / quota_exceeded(일일), 401 authentication(키 무효), 403 permission_denied,
// 구형 generateContent 응답은 RESOURCE_EXHAUSTED + QuotaFailure(quotaId에 PerDay) 형식이라 둘 다 본다.
export function classifyGeminiError(status, bodyText = '') {
  const body = String(bodyText);
  if (status === 401 || /API_KEY_INVALID|API key not valid|api key expired|"authentication"|reported as leaked/i.test(body))
    return 'invalid';
  if (status === 403) return /PERMISSION_DENIED|permission_denied|SERVICE_DISABLED/i.test(body) ? 'invalid' : 'fatal';
  if (status === 429) {
    if (/quota_exceeded|PerDay|per day|daily/i.test(body)) return 'exhausted';
    return 'transient';
  }
  if (status === 408 || status >= 500) return 'transient';
  return 'fatal';
}

export function loadGeminiKeys(env) {
  const keys = [1, 2, 3].map((n) => ({ index: n, value: env[`GEMINI_API_KEY_${n}`] })).filter((k) => k.value);
  if (!keys.length && env.GEMINI_API_KEY) keys.push({ index: 1, value: env.GEMINI_API_KEY });
  return keys;
}

export class KeyPool {
  constructor({
    keys,
    statePath,
    rotate = false,
    resetState = false,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = (msg) => console.log(msg),
    maxRetries = 3,
    baseDelayMs = 2000
  }) {
    this.keys = keys;
    this.statePath = statePath;
    this.rotate = rotate;
    this.now = now;
    this.sleep = sleep;
    this.log = log;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.state = resetState ? { keys: {} } : this.readState();
    // 24시간 지난 "소진" 표시는 풀어 준다
    for (const [idx, s] of Object.entries(this.state.keys)) {
      if (s.status === 'exhausted' && this.now() - Date.parse(s.at) >= EXHAUSTED_RESET_MS) delete this.state.keys[idx];
    }
    if (resetState) this.saveState();
    this.cursor = 0;
  }

  readState() {
    try {
      const data = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return data && data.keys ? data : { keys: {} };
    } catch {
      return { keys: {} };
    }
  }

  saveState() {
    if (!this.statePath) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  mark(key, status) {
    this.state.keys[key.index] = { status, at: new Date(this.now()).toISOString() };
    this.saveState();
  }

  usableKeys() {
    const list = this.rotate ? this.keys : this.keys.slice(0, 1);
    return list.filter((k) => !this.state.keys[k.index]);
  }

  describe() {
    return this.keys
      .map(
        (k) =>
          `key #${k.index}: ${this.state.keys[k.index]?.status === 'exhausted' ? '소진' : this.state.keys[k.index]?.status === 'invalid' ? '무효' : '사용 가능'}`
      )
      .join(', ');
  }

  // request(keyValue) → { ok: true, data } | { ok: false, status, body }
  async call(request) {
    for (;;) {
      const usable = this.usableKeys();
      if (!usable.length)
        throw new AllKeysUnavailableError(this.rotate ? this.describe() : `${this.describe()} · 전환은 --rotate-keys 일 때만`);
      const key = usable[Math.min(this.cursor, usable.length - 1)];
      let moveOn = false;
      for (let attempt = 0; attempt <= this.maxRetries && !moveOn; attempt += 1) {
        const res = await request(key.value);
        if (res.ok) return res.data;
        const kind = classifyGeminiError(res.status, res.body);
        if (kind === 'fatal')
          throw new FatalRequestError(res.status, (String(res.body).match(/"(?:status|code)"\s*:\s*"([A-Za-z_]+)"/) || [])[1]);
        if (kind === 'invalid') {
          this.log(`key #${key.index}: 인증 오류(잘못되었거나 만료된 키)로 건너뜁니다.`);
          this.mark(key, 'invalid');
          moveOn = true;
        } else if (kind === 'exhausted') {
          this.log(`key #${key.index}: 일일 한도 소진. 24시간 뒤 다시 씁니다.`);
          this.mark(key, 'exhausted');
          moveOn = true;
        } else if (attempt < this.maxRetries) {
          const wait = this.baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
          this.log(
            `key #${key.index}: 일시 오류(HTTP ${res.status}), ${Math.round(wait / 1000)}초 뒤 다시 시도 (${attempt + 1}/${this.maxRetries})`
          );
          await this.sleep(wait);
        } else {
          this.log(`key #${key.index}: 일시 오류가 ${this.maxRetries}회 재시도 후에도 계속됩니다.`);
          if (!this.rotate) throw new AllKeysUnavailableError(`key #${key.index} 일시 오류 지속`);
          // 전환 모드: 이번 실행에서는 다음 키로 넘어간다(상태 파일에는 남기지 않음)
          this.cursor += 1;
          if (this.cursor >= usable.length) throw new AllKeysUnavailableError('모든 키에서 일시 오류 지속');
          moveOn = true;
        }
      }
    }
  }
}
