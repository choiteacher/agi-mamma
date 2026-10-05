import { describe, expect, it } from 'vitest';

import { channelBias, chooseVideo, latestRatings } from '../videoChoice';
import { mergeData } from '../sync';
import { applyRatings } from '../../../scripts/apply-ratings.mjs';

const cand = (videoId, title, score, channelId = `ch-${videoId}`) => ({ videoId, title, score, channelId });
const entry = {
  candidates: [cand('a', '콩나물국 끓이기', 20, 'ch1'), cand('b', '아기 콩나물국', 10, 'ch2'), cand('c', '된장찌개', 30, 'ch3')],
  picked: 'a',
  pickedBy: 'auto'
};
const r = (id, rating, channelId, at = '2026-10-05T00:00:00Z') => ({ id, rating, channelId, recipeId: 'x', updated_at: at });

describe('영상 고르기', () => {
  it('평가가 없으면 제목에 요리 이름이 든 후보 중 점수 1위', () => {
    expect(chooseVideo(entry, '콩나물국').videoId).toBe('a');
  });
  it('👎 받은 영상은 바로 다음 후보로 바뀐다', () => {
    expect(chooseVideo(entry, '콩나물국', latestRatings([r('a', -1, 'ch1')])).videoId).toBe('b');
  });
  it('후보를 모두 👎 하면(제목 안 맞는 영상은 빼고) 영상 없음', () => {
    expect(chooseVideo(entry, '콩나물국', latestRatings([r('a', -1, 'ch1'), r('b', -1, 'ch2')]))).toBeNull();
  });
  it('다른 요리에서 👍 받은 채널 영상이 앞으로 온다', () => {
    const map = latestRatings([r('zz', 1, 'ch2'), r('yy', 1, 'ch2'), r('ww', 1, 'ch2')]);
    expect(channelBias(map)).toEqual({ ch2: 3 });
    expect(chooseVideo(entry, '콩나물국', map).videoId).toBe('b');
  });
  it('사람이 직접 고른 영상은 👎 가 아니면 그대로', () => {
    expect(chooseVideo({ ...entry, picked: 'b', pickedBy: null }, '콩나물국').videoId).toBe('b');
  });
  it('평가를 취소(0)하면 원래대로', () => {
    const map = latestRatings([r('a', -1, 'ch1')], [r('a', 0, 'ch1', '2026-10-06T00:00:00Z')]);
    expect(chooseVideo(entry, '콩나물국', map).videoId).toBe('a');
  });
});

describe('평가 공유와 모으기', () => {
  it('공유 코드 병합에 영상 평가가 들어가고, 같은 영상은 더 최근 평가', () => {
    const out = mergeData(
      { cookLog: [], stock: [], videoRatings: [r('a', 1, 'ch1')] },
      { cookLog: [], stock: [], videoRatings: [r('a', -1, 'ch1', '2026-10-07T00:00:00Z'), r('b', 1, 'ch2')] }
    );
    expect(out.merged.videoRatings.find((x) => x.id === 'a').rating).toBe(-1);
    expect(out.summary.videoRatings).toMatchObject({ added: 1, updated: 1 });
  });
  it('apply-ratings: 백업의 평가를 모으고 임시 선택을 다시 고른다', () => {
    const out = applyRatings({
      existing: [],
      incoming: [r('a', -1, 'ch1')],
      media: { soup: entry },
      recipes: [{ id: 'soup', name: '콩나물국' }]
    });
    expect(out.summary).toMatchObject({ changed: 1, total: 1, repicked: ['콩나물국'] });
    expect(out.media.soup).toMatchObject({ picked: 'b', pickedBy: 'auto' });
  });
});

describe('다른 이름으로 영상 찾기', () => {
  it('레시피 이름이 제목에 없어도 다른 이름(별칭)이 있으면 고른다', () => {
    const e = { candidates: [{ videoId: 'v', title: '소고기 표고 볶음 만들기', score: 1, channelId: 'c' }] };
    expect(chooseVideo(e, '쇠고기표고버섯볶음')).toBeNull();
    expect(chooseVideo(e, ['쇠고기표고버섯볶음', '소고기표고볶음']).videoId).toBe('v');
  });
  it('야채/채소, 돈육/돼지고기는 같은 말로 본다', () => {
    const e = { candidates: [{ videoId: 'v', title: '베이컨 야채 볶음밥', score: 1, channelId: 'c' }] };
    expect(chooseVideo(e, '베이컨채소볶음밥').videoId).toBe('v');
  });
});
