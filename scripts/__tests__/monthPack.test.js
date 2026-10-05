import { describe, expect, it } from 'vitest';

import menu from '../../src/data/menu-sets.seed.json';
import recipes from '../../src/data/recipes.seed.json';
import { MAX_DESCRIPTION_CHARS, buildRequest, ingredientRequest, parseIngredients } from '../lib/gemini.mjs';
import { extractIngredients, worthAskingGemini } from '../lib/descIngredients.mjs';
import { parseDuration, scoreVideo, searchCandidates } from '../lib/youtube.mjs';
import { fillFromDescription, needsDescription, searchQuery, titleMatches, upcomingRecipeIds } from '../make-month-pack.mjs';

describe('YouTube 후보', () => {
  it('ISO 8601 길이를 초로 바꾼다', () => {
    expect(parseDuration('PT8M30S')).toBe(510);
    expect(parseDuration('PT1H2M')).toBe(3720);
    expect(parseDuration('PT45S')).toBe(45);
    expect(parseDuration('bad')).toBeNull();
  });

  it('선호 채널, 적정 길이, 조회수 순으로 점수가 높다', () => {
    const base = { channelId: 'c1', durationSec: 600, viewCount: 1000, embeddable: true };
    expect(scoreVideo(base, { c1: 2 })).toBeGreaterThan(scoreVideo(base));
    expect(scoreVideo({ ...base, durationSec: 40 })).toBeLessThan(scoreVideo(base));
    expect(scoreVideo({ ...base, viewCount: 1e6 })).toBeGreaterThan(scoreVideo(base));
  });

  it('검색 결과의 실제 videoId만 쓰고, 공개 영상만 상위 3개, 요청 URL은 응답에 남지 않는다', async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url.includes('/search?'))
        return { ok: true, json: async () => ({ items: ['a', 'b', 'c', 'd', 'e'].map((v) => ({ id: { videoId: v } })) }) };
      return {
        ok: true,
        json: async () => ({
          items: ['a', 'b', 'c', 'd', 'e'].map((v, i) => ({
            id: v,
            snippet: {
              title: `t${v}`,
              channelTitle: 'ch',
              channelId: 'c',
              thumbnails: { medium: { url: `https://i.ytimg.com/vi/${v}/mqdefault.jpg` } }
            },
            contentDetails: { duration: 'PT8M' },
            statistics: { viewCount: String((i + 1) * 100) },
            status: { privacyStatus: v === 'e' ? 'unlisted' : 'public', embeddable: true }
          }))
        })
      };
    };
    const list = await searchCandidates('미역국 유아식 만들기', 'FAKEKEY', { fetchImpl: fake });
    expect(list.map((c) => c.videoId)).toEqual(['d', 'c', 'b']);
    expect(JSON.stringify(list)).not.toContain('FAKEKEY');
    expect(calls[0]).toContain('safeSearch=strict');
  });
});

describe('Gemini 설명란 재료 정리 (영상 분석 안 함)', () => {
  it('설명란 글만 보내고 영상(file_data)은 보내지 않는다', () => {
    const req = buildRequest('미역국', '재료는 미역 20g 소고기 100g');
    expect(req.contents[0].parts).toHaveLength(1);
    expect(JSON.stringify(req)).not.toContain('file_data');
    expect(req.contents[0].parts[0].text).toContain('미역 20g');
    expect(req.generationConfig.responseMimeType).toBe('application/json');
  });

  it('설명란이 길면 앞부분만 보낸다', () => {
    const req = buildRequest('미역국', '재료 ' + '가'.repeat(5000));
    expect(req.contents[0].parts[0].text.length).toBeLessThan(MAX_DESCRIPTION_CHARS + 400);
  });

  it('응답에서 재료 배열을 꺼낸다', () => {
    const body = { candidates: [{ content: { parts: [{ text: '{"ingredients":["미역 20g"," 소고기 100g "]}' }] } }] };
    expect(parseIngredients(body)).toEqual(['미역 20g', '소고기 100g']);
    expect(parseIngredients({ candidates: [] })).toBeNull();
  });

  it('키는 헤더로만 보내고 URL·본문에 넣지 않는다', async () => {
    let seen;
    const fake = async (url, init) => {
      seen = { url, init };
      return { ok: true, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ingredients":[]}' }] } }] }) };
    };
    const r = await ingredientRequest('미역국', '재료', { fetchImpl: fake })('SECRETKEY');
    expect(r.ok).toBe(true);
    expect(seen.url).not.toContain('SECRETKEY');
    expect(seen.init.body).not.toContain('SECRETKEY');
    expect(seen.init.headers['x-goog-api-key']).toBe('SECRETKEY');
  });

  it('오류 응답은 상태와 본문을 KeyPool 이 분류할 수 있게 넘긴다', async () => {
    const fake = async () => ({ ok: false, status: 429, text: async () => '{"error":{"code":"quota_exceeded"}}' });
    const r = await ingredientRequest('u', 'x', { fetchImpl: fake })('k');
    expect(r).toMatchObject({ ok: false, status: 429 });
  });
});

describe('설명란 재료 뽑기 (규칙, Gemini 없음)', () => {
  it('[재료] 제목 아래 줄들을 뽑고 만드는 법에서 멈춘다', () => {
    const d = [
      '맛있는 미역국 만들기',
      '',
      '[재료]',
      '- 마른 미역 20g',
      '- 소고기 100g',
      '▶ 국간장 1큰술',
      '',
      '[만드는 법]',
      '1. 미역을 불린다',
      '#미역국'
    ].join('\n');
    expect(extractIngredients(d)).toEqual(['마른 미역 20g', '소고기 100g', '국간장 1큰술']);
  });
  it('양념 제목도 이어서 뽑는다', () => {
    const d = ['재료', '두부 1모', '애호박 1/2개', '양념장', '간장 1큰술', '참기름 약간', '만드는 방법', '...'].join('\n');
    expect(extractIngredients(d)).toEqual(['두부 1모', '애호박 1/2개', '간장 1큰술', '참기름 약간']);
  });
  it('"재료: a, b, c" 한 줄 형식', () => {
    expect(extractIngredients('재료 : 콩나물 300g, 대파 1/2대, 소금 약간')).toEqual(['콩나물 300g', '대파 1/2대', '소금 약간']);
  });
  it('재료가 없는 설명란은 빈 배열, Gemini 대상도 아님', () => {
    const d = ['구독과 좋아요 부탁드려요', 'instagram: @abc'].join('\n');
    expect(extractIngredients(d)).toEqual([]);
    expect(worthAskingGemini(d)).toBe(false);
  });
  it('후보에 재료를 채우고, 규칙으로 못 뽑은 "재료" 언급 설명란만 Gemini 대상으로 표시', () => {
    const a = { videoId: 'a' };
    expect(fillFromDescription(a, ['재료', '두부 1모', '달걀 2개'].join('\n'))).toBe(false);
    expect(a).toMatchObject({ descIngredients: ['두부 1모', '달걀 2개'], descSource: 'rule' });
    const b = { videoId: 'b' };
    expect(fillFromDescription(b, '오늘은 집에 있는 재료로 두부랑 달걀만 넣어서 간단하게 만들었어요')).toBe(true);
    expect(b).toMatchObject({ descIngredients: [], descSource: null });
    expect(needsDescription(b)).toBe(false);
  });
});

describe('대상 레시피', () => {
  it('앞으로 30일 기본 일정에 나오는 레시피만, 중복 없이', () => {
    const ids = upcomingRecipeIds({ sets: menu.sets, recipes, today: '2026-10-04' });
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(recipes.map((r) => r.id));
    for (const id of ids) expect(known.has(id)).toBe(true);
  });

  it('검색어는 "<요리명> 유아식 만들기"', () => {
    expect(searchQuery({ name: '미역국' })).toBe('미역국 유아식 만들기');
  });
});

describe('titleMatches (임시 자동 선택)', () => {
  it('띄어쓰기와 쇠고기/소고기·달걀/계란 차이는 무시한다', () => {
    expect(titleMatches('절대 소고기 무국 이렇게', '쇠고기무국')).toBe(true);
    expect(titleMatches('계란 두부구이 만들기', '달걀두부구이')).toBe(true);
  });
  it('요리 이름이 제목에 없으면 고르지 않는다', () => {
    expect(titleMatches('제육볶음 황금레시피', '돈육김치볶음')).toBe(false);
    expect(titleMatches('애호박된장찌개', '팽이장국')).toBe(false);
  });
});

describe('설명란 재료 뽑기 - 조리 순서 문장', () => {
  it('재료 뒤 번호 붙은 조리 순서 문장은 재료로 넣지 않는다', () => {
    const d = [
      '재료 무우반개, 대파2대, 마늘2T',
      '',
      '양념 : 국간장3T, 참기름1T',
      '',
      '1. 재료를 손질해주세요',
      '',
      '2. 끓는 물에 소고기를 10초간 데친 후 건져내주세요'
    ].join('\n');
    expect(extractIngredients(d)).toEqual(['무우반개', '대파2대', '마늘2T', '국간장3T', '참기름1T']);
  });
});
