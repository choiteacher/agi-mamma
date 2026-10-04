// 앞으로 30일 일정에 나올 레시피의 유튜브 영상 후보 만들기 (내 PC에서 가끔 수동 실행)
//
//   npm run month-pack -- [--dry-run] [--limit N] [--rotate-keys] [--reset-keys] [--no-summary] [--auto-pick]
//
//   --no-summary: Gemini 요약 없이 영상 후보만 저장. 나중에 이 옵션 없이 다시 실행하면 빠진 요약만 채운다(검색은 다시 안 함).
//   --auto-pick: 아직 안 고른 레시피는 점수 1위 후보를 임시로 고른다(pickedBy: "auto"). npm run curate 로 바꿀 수 있다.
//
// 1) 기본 일정(아무 기록 없는 상태)을 계산해 앞으로 30일 안에 나오는 레시피 중 영상이 없는 것을 고른다.
// 2) YouTube Data API로 "<요리명> 유아식 만들기" 검색 → 실제 videoId, 임베드 가능 여부, 길이, 조회수 → 규칙 점수 상위 3개
// 3) Gemini로 각 후보 요약(재료, 순서, 34개월 주의점, 확인 불가 항목)
// 4) src/data/recipe-media.json 에 레시피마다 저장(후보 3개, picked는 null). 고르기는 npm run curate
//
// - 레시피 하나를 끝낼 때마다 저장하므로, 중간에 멈춰도 같은 명령을 다시 실행하면 끝낸 레시피는 건너뛴다.
// - 키는 저장소 밖 비밀키 파일에서만 읽고, 어떤 출력·파일에도 남기지 않는다(로그에는 key #번호만).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSecrets } from './lib/secrets.mjs';
import { AllKeysUnavailableError, KeyPool, loadGeminiKeys } from './lib/keyPool.mjs';
import { YouTubeError, searchCandidates } from './lib/youtube.mjs';
import { DEFAULT_MODEL, summarizeRequest } from './lib/gemini.mjs';
import { buildPlan } from '../src/lib/planner.js';
import { addDays, todayYmd } from '../src/lib/dates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_PATH = path.join(ROOT, 'src', 'data', 'recipe-media.json');
const PREFS_PATH = path.join(ROOT, 'src', 'data', 'channel-prefs.json');
const STATE_PATH = path.join(ROOT, 'scripts', 'output', 'key-state.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = has('--dry-run');
const LIMIT = Number(opt('--limit')) || Infinity;
const NO_SUMMARY = has('--no-summary');
const AUTO_PICK = has('--auto-pick');

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};

// 앞으로 30일 동안 기본 일정에 나오는 레시피 (등장 순서)
export function upcomingRecipeIds({ sets, recipes, today, days = 30 }) {
  const plan = buildPlan({ sets, recipes, today });
  const until = addDays(today, days - 1);
  const byId = new Map(sets.map((s) => [s.id, s]));
  const ids = [];
  for (const s of plan.sessions) {
    if (!s.setId || s.date < today || s.date > until) continue;
    for (const d of byId.get(s.setId).dishes) if (d.role === 'dish' && d.recipe_id && !ids.includes(d.recipe_id)) ids.push(d.recipe_id);
  }
  return ids;
}

// 영상 제목에 요리 이름이 들어 있는지 (띄어쓰기 무시, 쇠고기/소고기·달걀/계란은 같은 말로)
const normName = (s) =>
  s
    .replace(/\s+/g, '')
    .replace(/쇠고기/g, '소고기')
    .replace(/계란/g, '달걀');
export const titleMatches = (title, dishName) => normName(title).includes(normName(dishName));

export const searchQuery = (recipe) => `${recipe.name.replace(/\s+/g, ' ')} 유아식 만들기`;

async function main() {
  const sets = readJson(path.join(ROOT, 'src', 'data', 'menu-sets.seed.json'), { sets: [] }).sets;
  const recipes = readJson(path.join(ROOT, 'src', 'data', 'recipes.seed.json'), []);
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const media = readJson(MEDIA_PATH, {});
  const prefs = readJson(PREFS_PATH, {});

  const upcoming = upcomingRecipeIds({ sets, recipes, today: todayYmd() });
  const hasCandidates = (id) => Boolean(media[id] && media[id].candidates && media[id].candidates.length);
  const needsSummary = (id) => hasCandidates(id) && media[id].candidates.some((c) => !c.summary);
  const targets = upcoming.filter((id) => !hasCandidates(id) || (!NO_SUMMARY && needsSummary(id)));

  // 제목에 요리 이름이 들어간 후보 중 점수 1위를 임시로 고른다. 맞는 후보가 없으면 고르지 않는다(글 레시피만).
  // 사람이 고른 것(pickedBy 없음)은 건드리지 않고, 임시 선택(pickedBy: "auto")은 실행할 때마다 다시 계산한다.
  const autoPick = (id) => {
    const m = media[id];
    if (!AUTO_PICK || !m || (m.picked && m.pickedBy !== 'auto') || !hasCandidates(id)) return false;
    const best = [...m.candidates].filter((c) => titleMatches(c.title, recipesById.get(id).name)).sort((a, b) => b.score - a.score)[0];
    const picked = best ? best.videoId : null;
    if (picked === m.picked) return false;
    media[id] = { ...m, picked, pickedAt: picked ? new Date().toISOString() : null, pickedBy: picked ? 'auto' : null };
    return true;
  };
  const save = () => {
    if (!DRY) fs.writeFileSync(MEDIA_PATH, JSON.stringify(media, null, 2) + '\n');
  };

  console.log(
    `앞으로 30일 레시피 ${upcoming.length}개 중 영상 후보 또는 요약이 필요한 것: ${targets.length}개${Number.isFinite(LIMIT) ? ` (이번에 최대 ${LIMIT}개)` : ''}`
  );
  if (upcoming.map(autoPick).some(Boolean)) save();
  if (!targets.length) return;

  const secrets = loadSecrets();
  if (!secrets.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY 가 비밀키 파일에 없습니다. 비밀키 파일(.agi-pig-secrets/.env)에 추가한 뒤 다시 실행하세요.');
    process.exit(1);
  }
  let pool = null;
  if (NO_SUMMARY) {
    console.log('--no-summary: Gemini 요약 없이 영상 후보만 저장합니다.');
  } else {
    const keys = loadGeminiKeys(secrets);
    if (!keys.length) {
      console.error('GEMINI_API_KEY_1 (또는 GEMINI_API_KEY) 가 비밀키 파일에 없습니다.');
      process.exit(1);
    }
    pool = new KeyPool({ keys, statePath: STATE_PATH, rotate: has('--rotate-keys'), resetState: has('--reset-keys') });
    console.log(
      `Gemini 모델: ${DEFAULT_MODEL} · 키 ${keys.length}개 (${pool.describe()}) · 키 전환 ${has('--rotate-keys') ? '켜짐' : '꺼짐(기본)'}`
    );
  }
  if (DRY) console.log('--dry-run: 저장하지 않고 결과만 출력합니다.');

  let done = 0;
  try {
    for (const id of targets.slice(0, LIMIT)) {
      const recipe = recipesById.get(id);
      const query = searchQuery(recipe);
      // 이미 받은 후보가 있으면 다시 검색하지 않고 빠진 요약만 채운다
      if (hasCandidates(id)) {
        for (const c of media[id].candidates) {
          if (c.summary) continue;
          c.summary = await pool.call(summarizeRequest(`https://www.youtube.com/watch?v=${c.videoId}`, recipe.name));
          c.summarizedWith = DEFAULT_MODEL;
          save();
        }
        done += 1;
        console.log(`[${done}] ${recipe.name}: 빠진 요약 채움`);
        continue;
      }
      let candidates;
      try {
        candidates = await searchCandidates(query, secrets.YOUTUBE_API_KEY, { channelPrefs: prefs });
      } catch (e) {
        if (e instanceof YouTubeError && e.status === 400) {
          console.error(`
YouTube API가 요청을 거부했습니다 (${e.message}). YOUTUBE_API_KEY 가 아직 실제 키가 아니거나 잘못되었을 수 있습니다.`);
          process.exitCode = 1;
          break;
        }
        if (e instanceof YouTubeError && (e.status === 403 || e.status === 429)) {
          console.error(`\nYouTube API 한도 또는 권한 문제로 멈춥니다 (${e.message}). 한도는 태평양 시간 자정에 초기화됩니다.`);
          break;
        }
        throw e;
      }
      const entry = { query, searchedAt: new Date().toISOString(), candidates, picked: null };
      // 요약 전에 후보부터 저장해 두면, 요약 중 한도에 걸려도 YouTube 검색 쿼터를 다시 쓰지 않는다
      if (!DRY) media[id] = entry;
      if (!NO_SUMMARY) {
        for (const c of candidates) {
          save();
          const url = `https://www.youtube.com/watch?v=${c.videoId}`;
          c.summary = await pool.call(summarizeRequest(url, recipe.name));
          c.summarizedWith = DEFAULT_MODEL;
        }
      }
      done += 1;
      console.log(
        `[${done}] ${recipe.name}: 후보 ${candidates.length}개 ${candidates.map((c) => `"${c.title.slice(0, 30)}"(${c.channel}, 점수 ${c.score})`).join(' / ')}`
      );
      if (DRY) {
        console.log(JSON.stringify(entry, null, 2).slice(0, 1500));
      } else {
        autoPick(id);
        save();
      }
    }
  } catch (e) {
    if (e instanceof AllKeysUnavailableError) {
      save();
      console.error(`\n${e.message}`);
      console.error(
        `처리한 ${done}개는 저장했습니다. 한도가 풀린 뒤(태평양 시간 자정 이후, 또는 24시간 뒤) 같은 명령을 다시 실행하면 끝난 레시피는 건너뜁니다.`
      );
      process.exitCode = 2;
      return;
    }
    throw e;
  }
  console.log(`\n완료 ${done}개.${DRY ? '' : ' 이제 npm run curate 로 레시피마다 영상 1개를 고르세요.'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('오류:', e.message);
    process.exitCode = 1;
  });
}
