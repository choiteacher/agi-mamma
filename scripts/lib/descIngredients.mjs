// 유튜브 영상 "더보기"(설명란)에서 재료 목록만 뽑기 (내 PC 스크립트 전용)
//
// - 먼저 규칙으로 뽑는다(Gemini 호출 없음). "재료", "양념", "소스" 같은 제목 줄 뒤의 줄들, 또는 "재료: a, b, c" 형식.
// - 규칙으로 못 뽑았는데 설명란에 "재료"라는 말이 있을 때만 Gemini(텍스트만, 영상 분석 아님)로 정리한다.
// - 설명란 원문은 저장하지 않는다. 뽑은 재료 줄만 recipe-media.json 에 남긴다.

const HEADER = /(재료|양념|소스|드레싱|준비물|ingredients?)/i;
const STOP =
  /(만드는|만들기|조리\s*(법|순서|방법)|레시피\s*순서|순서|방법|how to|recipe|instagram|인스타|블로그|문의|구독|협찬|광고|bgm|music|#|https?:\/\/|www\.|━|═|──)/i;
const BULLET = /^[\s\-–•·▶▷►✔✅☑✓*◆◇■□○●◎※>\d.)]+/u;
const HANGUL = /[가-힣]/;
const SENTENCE = /(요|다|니다|세요|줘|죠)[.!~]*$|\s(후|다음|뒤에)\s/;

const clean = (line) =>
  line
    .replace(BULLET, '')
    .replace(/\s+/g, ' ')
    .replace(/^[:：]\s*/, '')
    .trim();

const isHeader = (line) => {
  const t = line.replace(/[[\]【】<>《》()（）:：■□▶▷►◆◇*\-=~\s]/g, '');
  return HEADER.test(t) && t.length <= 12;
};

// "재료: 두부 1모, 달걀 2개" 처럼 한 줄에 쓴 경우
const inlineItems = (line) => {
  const m = line.match(/(?:재료|양념|소스)[^:：]{0,6}[:：]\s*(.+)$/) || line.match(/^[^가-힣]*(?:재료|양념|소스)\s+([^,，]+[,，].+)$/);
  if (!m) return [];
  return m[1]
    .split(/[,，]|(?<!\d)\/(?!\d)| {2,}/)
    .map(clean)
    .filter((x) => x && HANGUL.test(x) && x.length <= 40 && !SENTENCE.test(x));
};

export function extractIngredients(description) {
  if (!description) return [];
  const lines = String(description).split(/\r?\n/);
  const out = [];
  let inSection = false;
  let blankRun = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inSection && out.length) blankRun += 1;
      if (blankRun >= 2) inSection = false;
      continue;
    }
    blankRun = 0;
    const inline = inlineItems(line);
    if (inline.length >= 2) {
      out.push(...inline);
      inSection = false;
      continue;
    }
    if (isHeader(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (STOP.test(line)) {
      inSection = false;
      continue;
    }
    const item = clean(line);
    // 조리 순서 문장(…주세요, …한다)이 나오면 재료 목록이 끝난 것
    if (SENTENCE.test(item)) {
      inSection = false;
      continue;
    }
    if (item && HANGUL.test(item) && item.length <= 40) out.push(item);
  }
  return [...new Set(out)].slice(0, 30);
}

// 규칙으로 못 뽑았을 때 Gemini 에 맡길 가치가 있는지 (재료 이야기가 있는 설명란만)
export const worthAskingGemini = (description) => /재료/.test(description || '') && String(description).length >= 30;
