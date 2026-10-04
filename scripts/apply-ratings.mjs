// 사이트에서 누른 영상 👍/👎 를 저장소에 모으기 (내 PC에서 실행)
//
//   npm run apply-ratings -- <백업파일.json> [<백업파일2.json> ...]
//
// 1) 설정 화면 "백업 파일 내려받기"로 받은 JSON 에서 videoRatings 만 읽는다(요리 기록 등은 읽지 않음).
// 2) src/data/video-ratings.json 에 합친다(같은 영상은 더 최근 평가). 이 파일은 커밋하면 두 사람 기기 모두의 기본값이 된다.
// 3) 임시로 고른 영상(pickedBy: "auto")은 평가를 반영해 다시 고른다(👎 영상 빼기, 채널 선호 반영).
// 이후 git commit/push 하면 사이트에 반영된다. 다음 npm run month-pack 검색 점수에도 채널 선호가 들어간다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { channelBias, chooseVideo, latestRatings } from '../src/lib/videoChoice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATINGS_PATH = path.join(ROOT, 'src', 'data', 'video-ratings.json');
const MEDIA_PATH = path.join(ROOT, 'src', 'data', 'recipe-media.json');
const RECIPES_PATH = path.join(ROOT, 'src', 'data', 'recipes.seed.json');

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

// 순수 함수: 기존 평가 + 들어온 평가 → 합친 평가, 다시 고른 media, 요약
export function applyRatings({ existing, incoming, media, recipes }) {
  const before = latestRatings(existing);
  const map = latestRatings(existing, incoming);
  let changed = 0;
  for (const [id, r] of map) if (before.get(id) !== r) changed += 1;
  const bias = channelBias(map);
  const names = new Map(recipes.map((r) => [r.id, r.name]));
  const nextMedia = { ...media };
  const repicked = [];
  for (const [id, m] of Object.entries(media)) {
    if (!m.candidates || !m.candidates.length || !names.has(id)) continue;
    const humanPick = m.picked && m.pickedBy !== 'auto' && map.get(m.picked)?.rating !== -1;
    if (humanPick) continue;
    const best = chooseVideo({ ...m, picked: null }, names.get(id), map, bias);
    const picked = best ? best.videoId : null;
    if (picked === m.picked) continue;
    nextMedia[id] = { ...m, picked, pickedAt: picked ? new Date().toISOString() : null, pickedBy: picked ? 'auto' : null };
    repicked.push(names.get(id));
  }
  const ratings = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { ratings, media: nextMedia, summary: { changed, total: ratings.length, repicked } };
}

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('사용법: npm run apply-ratings -- <백업파일.json>');
    process.exit(1);
  }
  const incoming = [];
  for (const f of files) {
    const data = readJson(path.resolve(f), null);
    if (!data || data.app !== 'agi-mamma') {
      console.error(`${path.basename(f)}: 아기돼지 삼형제 백업 파일이 아닙니다.`);
      process.exit(1);
    }
    incoming.push(...(data.videoRatings || []));
  }
  const out = applyRatings({
    existing: readJson(RATINGS_PATH, []),
    incoming,
    media: readJson(MEDIA_PATH, {}),
    recipes: readJson(RECIPES_PATH, [])
  });
  fs.writeFileSync(RATINGS_PATH, JSON.stringify(out.ratings, null, 2) + '\n');
  fs.writeFileSync(MEDIA_PATH, JSON.stringify(out.media, null, 2) + '\n');
  const up = out.ratings.filter((r) => r.rating === 1).length;
  const down = out.ratings.filter((r) => r.rating === -1).length;
  console.log(`평가 ${out.summary.changed}건 반영 (전체 👍 ${up} · 👎 ${down})`);
  if (out.summary.repicked.length) console.log(`영상을 다시 고른 레시피: ${out.summary.repicked.join(', ')}`);
  console.log('git commit/push 하면 사이트에 반영됩니다.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
