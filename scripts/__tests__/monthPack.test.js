import { describe, expect, it } from 'vitest';

import menu from '../../src/data/menu-sets.seed.json';
import recipes from '../../src/data/recipes.seed.json';
import { buildRequest, parseSummary, summarizeRequest } from '../lib/gemini.mjs';
import { parseDuration, scoreVideo, searchCandidates } from '../lib/youtube.mjs';
import { searchQuery, titleMatches, upcomingRecipeIds } from '../make-month-pack.mjs';

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

describe('Gemini 요약', () => {
  it('유튜브 URL을 file_data 로 보내고 JSON 응답을 요구한다', () => {
    const req = buildRequest('https://www.youtube.com/watch?v=abc', '미역국');
    expect(req.contents[0].parts[0]).toEqual({ file_data: { file_uri: 'https://www.youtube.com/watch?v=abc' } });
    expect(req.contents[0].parts[1].text).toMatch(/34개월/);
    expect(req.contents[0].parts[1].text).toMatch(/영상에서 확인 불가/);
    expect(req.generationConfig.responseMimeType).toBe('application/json');
  });

  it('응답을 정리하고, 주의점이 비면 "영상에서 확인 불가"로 채운다', () => {
    const body = {
      candidates: [
        { content: { parts: [{ text: '{"ingredients":["미역 20g"],"steps":["불린다"],"cautions":[],"unverifiable":["간"]}' }] } }
      ]
    };
    expect(parseSummary(body)).toEqual({
      ingredients: ['미역 20g'],
      steps: ['불린다'],
      cautions: ['영상에서 확인 불가'],
      unverifiable: ['간']
    });
    expect(parseSummary({ candidates: [] })).toBeNull();
  });

  it('키는 헤더로만 보내고 URL·본문에 넣지 않는다', async () => {
    let seen;
    const fake = async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"cautions":["작게 썰기"]}' }] } }] })
      };
    };
    const r = await summarizeRequest('https://www.youtube.com/watch?v=abc', '미역국', { fetchImpl: fake })('SECRETKEY');
    expect(r.ok).toBe(true);
    expect(seen.url).not.toContain('SECRETKEY');
    expect(seen.init.body).not.toContain('SECRETKEY');
    expect(seen.init.headers['x-goog-api-key']).toBe('SECRETKEY');
  });

  it('오류 응답은 상태와 본문을 KeyPool 이 분류할 수 있게 넘긴다', async () => {
    const fake = async () => ({ ok: false, status: 429, text: async () => '{"error":{"code":"quota_exceeded"}}' });
    const r = await summarizeRequest('u', 'x', { fetchImpl: fake })('k');
    expect(r).toMatchObject({ ok: false, status: 429 });
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
