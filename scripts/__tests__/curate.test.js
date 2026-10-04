import { describe, expect, it } from 'vitest';

import { applyPick } from '../lib/curate.mjs';

const media = {
  r1: {
    candidates: [
      { videoId: 'v1', channelId: 'cA' },
      { videoId: 'v2', channelId: 'cB' }
    ],
    picked: null
  }
};

describe('영상 고르기', () => {
  it('고르면 picked 와 채널 가산점이 저장된다', () => {
    const out = applyPick(media, {}, 'r1', 'v1');
    expect(out.media.r1.picked).toBe('v1');
    expect(out.prefs).toEqual({ cA: 1 });
  });

  it('다른 영상으로 바꾸면 이전 채널 점수는 빼고 새 채널에 더한다', () => {
    const first = applyPick(media, {}, 'r1', 'v1');
    const second = applyPick(first.media, first.prefs, 'r1', 'v2');
    expect(second.prefs).toEqual({ cB: 1 });
  });

  it('선택 해제하면 picked 는 null, 점수는 원래대로', () => {
    const first = applyPick(media, { cA: 2 }, 'r1', 'v1');
    const cleared = applyPick(first.media, first.prefs, 'r1', null);
    expect(cleared.media.r1.picked).toBeNull();
    expect(cleared.prefs).toEqual({ cA: 2 });
  });

  it('후보에 없는 영상이나 모르는 레시피는 거부한다', () => {
    expect(() => applyPick(media, {}, 'r1', 'zzz')).toThrow();
    expect(() => applyPick(media, {}, 'nope', 'v1')).toThrow();
  });
});
