import { describe, expect, it } from 'vitest';

import { KIMCHI_TIP, cautionsFor, cookEffort, cleanDishName, excludedReason, isKimchi, spicyInfo, splitDishes } from '../lib/dishRules.mjs';

describe('요리명 정리', () => {
  it('알레르기 번호, 괄호 표기, 기호를 지운다', () => {
    expect(cleanDishName('닭볶음탕(1.5.6.13.15.)')).toBe('닭볶음탕');
    expect(cleanDishName('*쇠고기미역국 5.6.16.')).toBe('쇠고기미역국');
    expect(cleanDishName('수제돈까스(완)(1.2.5.6.10.13)')).toBe('수제돈까스');
    expect(cleanDishName('@우리밀 [국산] 잔치국수')).toBe('우리밀 잔치국수');
    expect(cleanDishName('백미밥_원주')).toBe('백미밥');
  });

  it('<br/>로 나뉜 급식 문자열을 요리 목록으로 바꾼다', () => {
    expect(splitDishes('혼합잡곡밥<br/>감자국 (5.6.)<br/>배추김치 (9.)<br/>우유 (2.)')).toEqual([
      '혼합잡곡밥',
      '감자국',
      '배추김치',
      '우유'
    ]);
  });
});

describe('일정 대상 아님', () => {
  it('흰밥/잡곡밥, 우유, 과일은 제외하고 볶음밥 같은 일품은 남긴다', () => {
    expect(excludedReason('혼합잡곡밥')).toBe('밥(일정 제외)');
    expect(excludedReason('현미밥')).toBe('밥(일정 제외)');
    expect(excludedReason('우유')).toBe('음료/유제품');
    expect(excludedReason('샤인머스캣')).toBe('과일');
    expect(excludedReason('새우볶음밥')).toBeNull();
    expect(excludedReason('소불고기덮밥')).toBeNull();
    expect(excludedReason('콩나물밥')).toBeNull();
    expect(excludedReason('보리차')).toBe('음료/유제품');
    expect(excludedReason('잘게자른포도')).toBe('과일');
    expect(excludedReason('샤인머스켓')).toBe('과일');
  });

  it('과일 이름으로 시작해도 과일이 아닌 요리는 남긴다', () => {
    expect(excludedReason('배추김치')).toBeNull();
    expect(excludedReason('감자조림')).toBeNull();
    expect(excludedReason('사과당근샐러드')).toBeNull();
    expect(excludedReason('잡채')).toBeNull();
    expect(excludedReason('돼지고기짜장밥')).toBeNull();
    expect(excludedReason('우유달걀찜')).toBeNull();
    expect(cleanDishName('배추김치 1')).toBe('배추김치');
  });
});

describe('매운 요리 → 안 매운 대체안', () => {
  it('대표적인 매운 요리는 정해 둔 대체안을 제안한다', () => {
    expect(spicyInfo('돼지고기제육볶음')).toEqual({ level: 'spicy', mild: '간장 돼지불고기' });
    expect(spicyInfo('닭볶음탕')).toEqual({ level: 'spicy', mild: '간장 닭찜' });
    expect(spicyInfo('떡볶이').mild).toBe('궁중떡볶이(간장)');
    expect(spicyInfo('육개장').mild).toBe('소고기무국');
  });

  it('대체안 목록에 없는 매운 요리는 "고춧가루·고추장 빼고" 버전을 제안한다', () => {
    expect(spicyInfo('매콤어묵볶음')).toEqual({ level: 'spicy', mild: '매콤어묵볶음 (고춧가루·고추장 빼고 간장/소금 간)' });
  });

  it('김치류는 다른 요리로 바꾸지 않고 씻어서 먹이도록 제안한다', () => {
    expect(isKimchi('배추김치')).toBe(true);
    expect(isKimchi('깍두기')).toBe(true);
    expect(spicyInfo('배추김치')).toEqual({ level: 'kimchi', mild: KIMCHI_TIP });
    expect(cautionsFor('깍두기')).toContain('김치류(씻어서)');
  });

  it('이름에 이미 안 매운 버전이라고 밝힌 요리는 매운 요리로 보지 않는다', () => {
    expect(spicyInfo('안매운육개장').level).toBe('none');
    expect(spicyInfo('간장비빔국수').level).toBe('none');
  });

  it('매운 표시가 없는 요리는 건드리지 않는다', () => {
    expect(spicyInfo('소고기미역국')).toEqual({ level: 'none', mild: null });
    expect(spicyInfo('계란찜')).toEqual({ level: 'none', mild: null });
    expect(spicyInfo('핫케이크').level).toBe('none');
  });

  it('무침/조림처럼 고춧가루를 자주 쓰는 형태는 양념 확인으로 표시한다', () => {
    expect(spicyInfo('콩나물무침').level).toBe('maybe');
    expect(cautionsFor('콩나물무침')).toContain('맵기(양념 확인)');
  });
});

describe('34개월 주의 표시', () => {
  it('질식, 가시, 날것, 질감, 난이도를 표시한다', () => {
    expect(cautionsFor('멸치아몬드볶음')).toContain('질식위험');
    expect(cautionsFor('고등어구이')).toContain('가시');
    expect(cautionsFor('연어회')).toContain('날것');
    expect(cautionsFor('브로콜리숙회')).not.toContain('날것');
    expect(cautionsFor('유부초밥')).not.toContain('날것');
    expect(cautionsFor('오징어채볶음')).toContain('질감(질김/딱딱)');
    expect(cautionsFor('수제돈까스')).toContain('난이도 높음');
    expect(cautionsFor('소고기미역국')).toEqual([]);
  });
});

describe('조리 수고 (쉬운 날 고르기용)', () => {
  it('밥/김치/김은 0, 국·나물은 1, 볶음·조림·일품은 2, 튀김·전·만두는 3', () => {
    expect(['쌀밥', '배추김치', '깍두기', '김자반'].map(cookEffort)).toEqual([0, 0, 0, 0]);
    expect(['미역국', '시금치나물', '콩나물무침', '달걀찜'].map(cookEffort)).toEqual([1, 1, 1, 1]);
    expect(['감자채볶음', '두부조림', '돈사태찜', '새우볶음밥'].map(cookEffort)).toEqual([2, 2, 2, 2]);
    expect(['돈까스', '동그랑땡전', '물만두', '돼지고기잡채'].map(cookEffort)).toEqual([3, 3, 3, 3]);
    expect(cookEffort('물만두국')).toBe(1);
  });
});
