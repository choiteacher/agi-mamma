// NEIS 교육정보 개방 포털 Open API 호출 (https://open.neis.go.kr/hub/<서비스>)
// - 한 번에 최대 1,000건(pSize) → 페이지를 나눠 호출
// - 일일 트래픽 제한이 있으나 공식 수치는 공개되어 있지 않음 → 요청 사이에 지연을 두고, 제한 오류(ERROR-337)면 즉시 중단
// - 인증키가 들어간 URL은 절대 출력하지 않는다.
const BASE = 'https://open.neis.go.kr/hub/';
export const PAGE_SIZE = 1000;
export const REQUEST_DELAY_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class NeisError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

let lastCall = 0;
export let callCount = 0;

async function callOnce(key, service, params, pIndex) {
  const wait = lastCall + REQUEST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  callCount += 1;

  const qs = new URLSearchParams({ KEY: key, Type: 'json', pIndex: String(pIndex), pSize: String(PAGE_SIZE), ...params });
  let res;
  try {
    res = await fetch(BASE + service + '?' + qs.toString());
  } catch (e) {
    // 오류 메시지에 URL(인증키 포함)이 섞이지 않도록 원인 이름만 남긴다.
    throw new NeisError('NETWORK', `네트워크 오류 (${e.cause?.code || e.name})`);
  }
  if (!res.ok) throw new NeisError('HTTP', `HTTP ${res.status}`);
  const body = await res.json();

  if (body.RESULT) {
    // 데이터 없음(INFO-200)은 정상 빈 결과
    if (body.RESULT.CODE === 'INFO-200') return { total: 0, rows: [] };
    throw new NeisError(body.RESULT.CODE, body.RESULT.MESSAGE);
  }
  const [headPart, rowPart] = body[service];
  const head = headPart.head;
  const result = head.find((h) => h.RESULT)?.RESULT;
  if (result && result.CODE !== 'INFO-000') throw new NeisError(result.CODE, result.MESSAGE);
  return { total: head.find((h) => h.list_total_count)?.list_total_count ?? 0, rows: rowPart?.row ?? [] };
}

export async function neisGetAll(key, service, params) {
  const first = await callOnce(key, service, params, 1);
  const rows = [...first.rows];
  const pages = Math.ceil(first.total / PAGE_SIZE);
  for (let p = 2; p <= pages; p += 1) {
    rows.push(...(await callOnce(key, service, params, p)).rows);
  }
  return rows;
}

export const isTrafficLimit = (e) => e instanceof NeisError && e.code === 'ERROR-337';
