// 앞으로 30일 일정에 나올 레시피의 유튜브 영상 후보 만들기 (내 PC에서 가끔 수동 실행)
//
//   npm run month-pack -- [--all] [--dry-run] [--limit N] [--no-gemini] [--rotate-keys] [--reset-keys] [--auto-pick]
//
//   --all: 앞으로 30일만이 아니라 모든 레시피(씻어 먹이는 김치 제외)를 대상으로 한다.
//
// 1) 기본 일정(아무 기록 없는 상태)을 계산해 앞으로 30일 안에 나오는 레시피를 고른다.
// 2) 영상 후보가 없는 레시피: YouTube Data API로 "<요리명> 유아식 만들기" 검색 → 실제 videoId, 임베드 가능 여부, 길이, 조회수,
//    설명란 → 규칙 점수 상위 3개
// 3) 각 후보의 설명란("더보기")에서 재료 목록을 뽑는다. 영상 자체는 AI로 분석하지 않는다.
//    - 먼저 규칙으로 뽑는다(Gemini 호출 없음).
//    - 규칙으로 못 뽑았는데 설명란에 "재료"라는 말이 있으면, 사이트에 실제로 나오는 영상(임시 선택 1개)에 한해서만
//      Gemini(텍스트만)로 정리한다. --no-gemini 면 이 단계도 건너뛴다.
//    - 설명란 원문은 저장하지 않고 뽑은 재료 줄만 저장한다.
// 4) src/data/recipe-media.json 에 레시피마다 저장. --auto-pick 이면 사이트에 보여 줄 영상을 임시로 고른다(pickedBy: "auto").
//
// - 레시피 하나를 끝낼 때마다 저장하므로, 중간에 멈춰도 같은 명령을 다시 실행하면 끝낸 것은 건너뛴다.
// - 키는 저장소 밖 비밀키 파일에서만 읽고, 어떤 출력·파일에도 남기지 않는다(로그에는 key #번호만).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSecrets } from './lib/secrets.mjs';
import { AllKeysUnavailableError, KeyPool, loadGeminiKeys } from './lib/keyPool.mjs';
import { YouTubeError, fetchDescriptions, searchCandidates } from './lib/youtube.mjs';
import { DEFAULT_MODEL, ingredientRequest } from './lib/gemini.mjs';
import { extractIngredients, worthAskingGemini } from './lib/descIngredients.mjs';
import { buildPlan } from '../src/lib/planner.js';
import { addDays, todayYmd } from '../src/lib/dates.js';
import { channelBias, chooseVideo, latestRatings, titleMatches, videoNames } from '../src/lib/videoChoice.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_PATH = path.join(ROOT, 'src', 'data', 'recipe-media.json');
const PREFS_PATH = path.join(ROOT, 'src', 'data', 'channel-prefs.json');
const RATINGS_PATH = path.join(ROOT, 'src', 'data', 'video-ratings.json');
const NAMES_PATH = path.join(ROOT, 'src', 'data', 'video-names.json');
const STATE_PATH = path.join(ROOT, 'scripts', 'output', 'key-state.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = has('--dry-run');
const LIMIT = Number(opt('--limit')) || Infinity;
const NO_GEMINI = has('--no-gemini');
const AUTO_PICK = has('--auto-pick');
const ALL = has('--all');
// 영상이 필요 없는 레시피 (시판 김치를 씻어 먹이기)
const NO_VIDEO = new Set(['washed-kimchi']);

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

export { titleMatches };

export const searchQuery = (recipe) => `${recipe.name.replace(/\s+/g, ' ')} 유아식 만들기`;
// 첫 검색에서 제목에 요리 이름이 든 영상이 없으면 한 번 더: "유아식"을 빼고 검색
export const secondQuery = (recipe) => `${recipe.name.replace(/\s+/g, ' ')} 만들기`;

// 설명란 재료를 아직 확인하지 않은 후보 (확인했는데 재료가 없으면 descIngredients: [] 로 남는다)
export const needsDescription = (c) => !Array.isArray(c.descIngredients);

// 후보에 설명란 재료를 채운다(규칙). Gemini 로 넘길 만한 설명란이면 true 를 돌려준다.
export function fillFromDescription(c, description) {
  const items = extractIngredients(description);
  c.descIngredients = items;
  c.descSource = items.length ? 'rule' : null;
  // 규칙으로 못 뽑았지만 재료 이야기가 있는 설명란: 나중에 Gemini 로 정리할 대상으로 표시
  const ask = !items.length && worthAskingGemini(description);
  if (ask) c.descNeedsAi = true;
  else delete c.descNeedsAi;
  return ask;
}

async function main() {
  const sets = readJson(path.join(ROOT, 'src', 'data', 'menu-sets.seed.json'), { sets: [] }).sets;
  const recipes = readJson(path.join(ROOT, 'src', 'data', 'recipes.seed.json'), []);
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const aliasMap = readJson(NAMES_PATH, {});
  const namesOf = (id) => videoNames(recipesById.get(id), aliasMap);
  const media = readJson(MEDIA_PATH, {});
  // 채널 가산점 = curate 에서 고른 횟수 + 사이트 👍/👎 합계(npm run apply-ratings 로 모은 것)
  const ratingMap = latestRatings(readJson(RATINGS_PATH, []));
  const bias = channelBias(ratingMap);
  const prefs = { ...readJson(PREFS_PATH, {}) };
  for (const [ch, v] of Object.entries(bias)) prefs[ch] = (prefs[ch] || 0) + v;

  const upcoming = upcomingRecipeIds({ sets, recipes, today: todayYmd() });
  const hasCandidates = (id) => Boolean(media[id] && media[id].candidates && media[id].candidates.length);
  // 사이트에 보이는 영상이 Gemini 정리를 기다리는지 (Gemini 를 쓸 수 있을 때만 대상)
  const shownNeedsAi = (id) => {
    const m = media[id];
    const c = m && m.picked && m.candidates.find((x) => x.videoId === m.picked);
    return Boolean(c && c.descNeedsAi);
  };
  // 앞으로 30일 레시피 + 이미 후보가 있는 레시피(재료를 아직 안 뽑은 것)
  const known = Object.keys(media).filter((id) => recipesById.has(id) && !upcoming.includes(id));
  const rest = ALL ? recipes.map((r) => r.id).filter((id) => !upcoming.includes(id) && !known.includes(id)) : [];
  const noTitleMatch = (id) =>
    hasCandidates(id) &&
    (!media[id].secondSearchedAt || (namesOf(id).length > 1 && !media[id].aliasSearchedAt)) &&
    !media[id].candidates.some((c) => titleMatches(c.title, namesOf(id)));
  const targets = [...upcoming, ...known, ...rest].filter(
    (id) =>
      !NO_VIDEO.has(id) &&
      (!hasCandidates(id) || noTitleMatch(id) || media[id].candidates.some(needsDescription) || (!NO_GEMINI && shownNeedsAi(id)))
  );

  // 임시 선택: 사이트와 같은 규칙(chooseVideo) - 제목에 요리 이름이 든 후보 중 👎 아닌 것, 채널 선호 반영.
  // 사람이 고른 것(pickedBy 없음)은 건드리지 않고, 임시 선택(pickedBy: "auto")은 실행할 때마다 다시 계산한다.
  const autoPick = (id) => {
    const m = media[id];
    if (!AUTO_PICK || !m || (m.picked && m.pickedBy !== 'auto') || !hasCandidates(id)) return false;
    const best = chooseVideo({ ...m, picked: null }, namesOf(id), ratingMap, bias);
    const picked = best ? best.videoId : null;
    if (picked === m.picked) return false;
    media[id] = { ...m, picked, pickedAt: picked ? new Date().toISOString() : null, pickedBy: picked ? 'auto' : null };
    return true;
  };
  const save = () => {
    if (!DRY) fs.writeFileSync(MEDIA_PATH, JSON.stringify(media, null, 2) + '\n');
  };

  console.log(
    `${ALL ? `전체 레시피 ${recipes.length}개` : `앞으로 30일 레시피 ${upcoming.length}개`} 중 영상 후보 또는 설명란 재료가 필요한 것: ${targets.length}개${Number.isFinite(LIMIT) ? ` (이번에 최대 ${LIMIT}개)` : ''}`
  );
  if (Object.keys(media).map(autoPick).some(Boolean)) save();
  if (!targets.length) return;

  const secrets = loadSecrets();
  if (!secrets.YOUTUBE_API_KEY) {
    console.error('YOUTUBE_API_KEY 가 비밀키 파일에 없습니다. 비밀키 파일(.agi-pig-secrets/.env)에 추가한 뒤 다시 실행하세요.');
    process.exit(1);
  }
  let pool = null;
  if (!NO_GEMINI) {
    const keys = loadGeminiKeys(secrets);
    if (keys.length) {
      pool = new KeyPool({ keys, statePath: STATE_PATH, rotate: has('--rotate-keys'), resetState: has('--reset-keys') });
      console.log(
        `Gemini(설명란 정리용, 규칙으로 못 뽑을 때만): ${DEFAULT_MODEL} · 키 ${keys.length}개 (${pool.describe()}) · 키 전환 ${has('--rotate-keys') ? '켜짐' : '꺼짐(기본)'}`
      );
    } else {
      console.log('Gemini 키가 없어 설명란 재료는 규칙으로만 뽑습니다.');
    }
  }
  if (DRY) console.log('--dry-run: 저장하지 않고 결과만 출력합니다.');

  let done = 0;
  let geminiCalls = 0;
  let geminiOff = !pool;
  try {
    for (const id of targets.slice(0, LIMIT)) {
      const recipe = recipesById.get(id);
      let descriptions = new Map();
      const search = async (query) => {
        try {
          return await searchCandidates(query, secrets.YOUTUBE_API_KEY, { channelPrefs: prefs });
        } catch (e) {
          if (e instanceof YouTubeError && e.status === 400) {
            console.error(`\nYouTube API가 요청을 거부했습니다 (${e.message}). YOUTUBE_API_KEY 가 올바른지 확인하세요.`);
            process.exitCode = 1;
            return null;
          }
          if (e instanceof YouTubeError && (e.status === 403 || e.status === 429)) {
            console.error(`\nYouTube API 한도 또는 권한 문제로 멈춥니다 (${e.message}). 한도는 태평양 시간 자정에 초기화됩니다.`);
            return null;
          }
          throw e;
        }
      };
      const takeDescriptions = (list) => {
        for (const c of list) {
          descriptions.set(c.videoId, c.description);
          delete c.description;
        }
      };
      if (!hasCandidates(id)) {
        const query = searchQuery(recipe);
        const candidates = await search(query);
        if (!candidates) break;
        takeDescriptions(candidates);
        media[id] = { query, searchedAt: new Date().toISOString(), candidates, picked: null };
      } else {
        const ids = media[id].candidates.filter((c) => needsDescription(c) || c.descNeedsAi).map((c) => c.videoId);
        if (ids.length) descriptions = await fetchDescriptions(ids, secrets.YOUTUBE_API_KEY);
      }
      // 제목에 요리 이름이 든 후보가 없으면 "유아식" 없이 한 번 더 검색해서, 이름이 맞는 영상만 후보에 더한다
      const names = namesOf(id);
      const addFitting = (more) => {
        const seen = new Set(media[id].candidates.map((c) => c.videoId));
        const fit = more.filter((c) => !seen.has(c.videoId) && titleMatches(c.title, names));
        takeDescriptions(more);
        media[id] = { ...media[id], candidates: [...media[id].candidates, ...fit] };
      };
      const noMatch = () => !media[id].candidates.some((c) => titleMatches(c.title, names));
      if (!media[id].secondSearchedAt && noMatch()) {
        const more = await search(secondQuery(recipe));
        if (!more) break;
        addFitting(more);
        media[id].secondSearchedAt = new Date().toISOString();
      }
      // 그래도 없으면 다른 이름(video-names.json 첫 번째)으로 한 번 더
      const alias = names[1];
      if (alias && !media[id].aliasSearchedAt && noMatch()) {
        const more = await search(`${alias} 만들기`);
        if (!more) break;
        addFitting(more);
        media[id].aliasSearchedAt = new Date().toISOString();
      }

      // 규칙으로 재료 뽑기
      const askGemini = new Map();
      for (const c of media[id].candidates) {
        if (!descriptions.has(c.videoId)) continue;
        if (needsDescription(c)) fillFromDescription(c, descriptions.get(c.videoId));
        if (c.descNeedsAi) askGemini.set(c.videoId, descriptions.get(c.videoId));
      }
      autoPick(id);

      // Gemini 는 사이트에 실제로 나오는 영상 1개에만
      const shown = media[id].picked;
      if (!geminiOff && shown && askGemini.has(shown)) {
        try {
          const items = await pool.call(ingredientRequest(recipe.name, askGemini.get(shown)));
          geminiCalls += 1;
          const c = media[id].candidates.find((x) => x.videoId === shown);
          if (items && items.length) {
            c.descIngredients = items;
            c.descSource = 'gemini';
          }
          delete c.descNeedsAi; // 재료가 없다고 답해도 다시 묻지 않는다
        } catch (e) {
          if (!(e instanceof AllKeysUnavailableError)) throw e;
          console.error(`\n${e.message} 남은 레시피는 규칙으로만 뽑습니다.`);
          geminiOff = true;
        }
      }

      done += 1;
      const summary = media[id].candidates.map(
        (c) => `${c.channel.slice(0, 12)}: 재료 ${c.descIngredients.length}개${c.descSource === 'gemini' ? '(AI 정리)' : ''}`
      );
      console.log(`[${done}] ${recipe.name}: ${summary.join(' / ')}`);
      if (DRY) console.log(JSON.stringify(media[id], null, 2).slice(0, 1500));
      save();
    }
  } finally {
    save();
  }
  console.log(`\n완료 ${done}개 · Gemini 호출 ${geminiCalls}회.${DRY ? '' : ' 커밋·push 하면 사이트에 반영됩니다.'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error('오류:', e.message);
    process.exitCode = 1;
  });
}
