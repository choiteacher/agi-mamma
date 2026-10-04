// 레시피 영상 고르기 (사이트와 내 PC 스크립트가 같이 쓰는 순수 함수)
//
// - 평가(ratings): [{ id: videoId, recipeId, channelId, rating: 1 | -1 | 0, updated_at }]
//   사이트에서 👍/👎 를 누를 때마다 쌓이고, 백업 파일 → npm run apply-ratings 로 src/data/video-ratings.json 에 모인다.
// - 👎 받은 영상은 다시 보여 주지 않는다. 고른 영상(picked)이 👎 면 다음 후보로 넘어간다.
// - 채널 선호: 그 채널 영상에 받은 👍 - 👎 합계. 후보 순서를 정할 때 점수에 더한다.

// 영상 제목에 요리 이름이 들어 있는지 (띄어쓰기 무시, 쇠고기/소고기·달걀/계란은 같은 말로)
const normName = (s) =>
  s
    .replace(/\s+/g, '')
    .replace(/쇠고기/g, '소고기')
    .replace(/계란/g, '달걀');
export const titleMatches = (title, dishName) => normName(title).includes(normName(dishName));

export const CHANNEL_WEIGHT = 5;

// 같은 영상 평가가 여러 개면(두 기기 병합 등) 가장 최근 것
export function latestRatings(...lists) {
  const map = new Map();
  for (const r of lists.flat()) {
    if (!r || !r.id) continue;
    const prev = map.get(r.id);
    if (!prev || (r.updated_at || '') > (prev.updated_at || '')) map.set(r.id, r);
  }
  return map;
}

export function channelBias(ratingMap) {
  const bias = {};
  for (const r of ratingMap.values()) if (r.channelId && r.rating) bias[r.channelId] = (bias[r.channelId] || 0) + r.rating;
  return bias;
}

// entry: recipe-media.json 의 한 레시피 항목. 보여 줄 영상 또는 null(글 레시피만)
export function chooseVideo(entry, dishName, ratingMap = new Map(), bias = channelBias(ratingMap)) {
  if (!entry || !entry.candidates || !entry.candidates.length) return null;
  const disliked = (c) => ratingMap.get(c.videoId)?.rating === -1;
  const picked = entry.picked && entry.candidates.find((c) => c.videoId === entry.picked);
  // 사람이 직접 고른 영상은 👎 가 아니면 그대로
  if (picked && entry.pickedBy !== 'auto' && !disliked(picked)) return picked;
  const ranked = entry.candidates
    .filter((c) => !disliked(c) && titleMatches(c.title, dishName))
    .map((c) => ({ c, s: (c.score || 0) + (bias[c.channelId] || 0) * CHANNEL_WEIGHT + (ratingMap.get(c.videoId)?.rating === 1 ? 100 : 0) }))
    .sort((a, b) => b.s - a.s || a.c.videoId.localeCompare(b.c.videoId));
  return ranked.length ? ranked[0].c : null;
}
