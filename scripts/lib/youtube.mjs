// YouTube Data API v3 (내 PC 스크립트 전용, 키는 비밀키 파일의 YOUTUBE_API_KEY)
// 쿼터(공식 문서): search.list 는 하루 100회(1회 1), videos.list 는 하루 10,000 단위 중 1회 1. 태평양 시간 자정 초기화.
// 실제 검색 결과의 videoId 만 쓴다(지어내지 않음). 키가 들어간 URL은 출력하지 않는다.
const API = 'https://www.googleapis.com/youtube/v3/';

export class YouTubeError extends Error {
  constructor(status, reason) {
    super(`YouTube API 오류 (HTTP ${status}${reason ? `, ${reason}` : ''})`);
    this.status = status;
    this.reason = reason;
  }
}

async function get(endpoint, params, key, fetchImpl) {
  const qs = new URLSearchParams({ ...params, key });
  let res;
  try {
    res = await fetchImpl(API + endpoint + '?' + qs.toString());
  } catch (e) {
    throw new YouTubeError('NETWORK', e.cause?.code || e.name);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new YouTubeError(res.status, body?.error?.errors?.[0]?.reason || body?.error?.status);
  return body;
}

// ISO 8601 길이(PT1H2M3S) → 초
export function parseDuration(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d = 0, h = 0, mi = 0, s = 0] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

// 규칙 점수: 선호 채널 가산점 + 적정 길이(3~15분) + 조회수(로그) - 쇼츠/너무 긴 영상 감점
export function scoreVideo(v, channelPrefs = {}) {
  let score = 0;
  score += (channelPrefs[v.channelId] || 0) * 5;
  const min = (v.durationSec || 0) / 60;
  if (min >= 3 && min <= 15) score += 10;
  else if (min > 15 && min <= 25) score += 4;
  else if (min < 1) score -= 10;
  else score -= 2;
  score += Math.log10((v.viewCount || 0) + 1) * 2;
  if (v.embeddable === false) score -= 3;
  return Math.round(score * 100) / 100;
}

export async function searchCandidates(query, key, { channelPrefs = {}, fetchImpl = fetch, maxResults = 10, top = 3 } = {}) {
  const search = await get(
    'search',
    {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(maxResults),
      regionCode: 'KR',
      relevanceLanguage: 'ko',
      safeSearch: 'strict'
    },
    key,
    fetchImpl
  );
  const ids = (search.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await get(
    'videos',
    { part: 'snippet,contentDetails,status,statistics', id: ids.join(','), maxResults: String(ids.length) },
    key,
    fetchImpl
  );
  return (details.items || [])
    .filter((v) => v.status && v.status.privacyStatus === 'public')
    .map((v) => {
      const c = {
        videoId: v.id,
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        channelId: v.snippet.channelId,
        thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || null,
        durationSec: parseDuration(v.contentDetails?.duration),
        viewCount: Number(v.statistics?.viewCount || 0),
        embeddable: v.status.embeddable !== false
      };
      return { ...c, score: scoreVideo(c, channelPrefs) };
    })
    .sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId))
    .slice(0, top);
}
