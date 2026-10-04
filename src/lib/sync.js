// 부부 사이 데이터 공유(서버 없음): 공유 코드 / JSON 백업 파일
// - 공유 코드: JSON → deflate 압축 → base64url, 앞에 형식 표시("AGM1." 압축, "AGM0." 압축 안 함)
// - 가져오기: 요리 기록·재고를 id 기준으로 합친다(합집합). 같은 id면 updated_at이 더 최근인 쪽을 쓴다.
//   설정도 updated_at이 더 최근인 쪽을 쓴다. 적용 전에 바뀌는 내용을 요약해 보여 준다.

export const APP_ID = 'agi-mamma';
export const DATA_VERSION = 1;

export function buildExport({ settings, cookLog, stock, videoRatings = [] }, now = new Date().toISOString()) {
  return { app: APP_ID, version: DATA_VERSION, exportedAt: now, settings, cookLog, stock, videoRatings };
}

export function validateImport(data) {
  if (!data || data.app !== APP_ID) throw new Error('아기돼지 삼형제에서 만든 데이터가 아닙니다.');
  if (data.version > DATA_VERSION) throw new Error('더 새 버전 앱에서 만든 데이터입니다. 앱을 새로고침한 뒤 다시 시도하세요.');
  if (!Array.isArray(data.cookLog) || !Array.isArray(data.stock)) throw new Error('데이터 형식이 올바르지 않습니다.');
  return data;
}

const newer = (a, b) => (a.updated_at || '') > (b.updated_at || '');

function mergeList(local, incoming) {
  const map = new Map(local.map((x) => [x.id, x]));
  const summary = { added: 0, updated: 0, unchanged: 0 };
  for (const item of incoming) {
    if (!item || !item.id) continue;
    const mine = map.get(item.id);
    if (!mine) {
      map.set(item.id, item);
      summary.added += 1;
    } else if (newer(item, mine)) {
      map.set(item.id, item);
      summary.updated += 1;
    } else {
      summary.unchanged += 1;
    }
  }
  return { list: [...map.values()], summary };
}

export function mergeData(local, incoming) {
  const cook = mergeList(local.cookLog || [], incoming.cookLog || []);
  const stock = mergeList(local.stock || [], incoming.stock || []);
  // 영상 평가는 영상 id 기준 (예전 데이터에는 없음)
  const ratings = mergeList(local.videoRatings || [], incoming.videoRatings || []);
  let settings = local.settings;
  let settingsResult = 'same';
  if (incoming.settings && newer(incoming.settings, local.settings || {})) {
    settings = incoming.settings;
    settingsResult = 'incoming';
  } else if (incoming.settings && JSON.stringify(incoming.settings) !== JSON.stringify(local.settings)) {
    settingsResult = 'local';
  }
  return {
    merged: { settings, cookLog: cook.list, stock: stock.list, videoRatings: ratings.list },
    summary: { cookLog: cook.summary, stock: stock.summary, videoRatings: ratings.summary, settings: settingsResult }
  };
}

// ---------------------------------------------------------------- 인코딩
const toBase64Url = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encodeShareCode(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (canCompress()) return 'AGM1.' + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'AGM0.' + toBase64Url(bytes);
}

export async function decodeShareCode(code) {
  const text = String(code || '').replace(/\s+/g, '');
  const m = text.match(/^AGM([01])\.([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('공유 코드 형식이 아닙니다. 코드 전체를 빠짐없이 붙여 넣었는지 확인하세요.');
  let bytes;
  try {
    bytes = fromBase64Url(m[2]);
    if (m[1] === '1') {
      if (!canCompress()) throw new Error('이 브라우저는 압축된 공유 코드를 풀 수 없습니다.');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return validateImport(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    if (e.message && /아기돼지|버전|형식|브라우저/.test(e.message)) throw e;
    throw new Error('공유 코드가 손상되었습니다. 코드 전체를 다시 복사해 주세요.');
  }
}

export const describeSummary = ({ cookLog, stock, videoRatings = { added: 0, updated: 0 }, settings }) => [
  `요리 기록: 새로 ${cookLog.added}건, 갱신 ${cookLog.updated}건`,
  `영상 평가: 새로 ${videoRatings.added}건, 갱신 ${videoRatings.updated}건`,
  ...(stock.added || stock.updated ? [`재고(이전 버전 기록): 새로 ${stock.added}건, 갱신 ${stock.updated}건`] : []),
  settings === 'incoming'
    ? '설정: 가져온 쪽이 더 최근이라 바꿉니다'
    : settings === 'local'
      ? '설정: 이 기기 설정을 유지합니다'
      : '설정: 같음'
];
