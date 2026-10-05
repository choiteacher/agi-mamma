// Gemini로 유튜브 설명란의 재료 정리 (내 PC 스크립트 전용)
//
// - 영상은 분석하지 않는다(영상 입력은 토큰이 많이 들어 무료 한도가 빨리 찬다). 설명란 "글"만 보낸다.
// - 규칙(descIngredients.mjs)으로 재료를 못 뽑은 설명란에만 부른다.
// - 모델: 공식 문서(ai.google.dev/gemini-api/docs/models, 2026-10 확인) 기준 gemini-3.8-flash 보다 한 단계 아래인 gemini-3.7-flash.
//   더 아끼려면 GEMINI_MODEL=gemini-3.5-flash-lite 처럼 환경변수로 바꿀 수 있다.
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

// 설명란이 길면 앞부분만 보낸다(재료는 대개 앞쪽에 있다)
export const MAX_DESCRIPTION_CHARS = 1500;

export const INGREDIENT_PROMPT = (dishName, description) => `아래는 "${dishName}" 요리 유튜브 영상의 설명란입니다.
설명란에 적힌 재료와 양만 뽑아 주세요. 설명란에 없는 재료는 넣지 마세요. 재료가 없으면 빈 배열로 답하세요.
다음 JSON 형식으로만 답하세요: {"ingredients": ["재료 양", ...]}

설명란:
${String(description).slice(0, MAX_DESCRIPTION_CHARS)}`;

export function buildRequest(dishName, description) {
  return {
    contents: [{ role: 'user', parts: [{ text: INGREDIENT_PROMPT(dishName, description) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 400 }
  };
}

// 응답에서 재료 배열을 꺼낸다. 형식이 어긋나면 null
export function parseIngredients(body) {
  const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return null;
  try {
    const s = JSON.parse(json[0]);
    return Array.isArray(s.ingredients)
      ? s.ingredients
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 30)
      : null;
  } catch {
    return null;
  }
}

// KeyPool.call 에 넘길 요청 함수 (키 값은 헤더로만 보내고 어디에도 남기지 않는다)
export const ingredientRequest =
  (dishName, description, { model = DEFAULT_MODEL, fetchImpl = fetch } = {}) =>
  async (apiKey) => {
    let res;
    try {
      res = await fetchImpl(ENDPOINT(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildRequest(dishName, description))
      });
    } catch (e) {
      return { ok: false, status: 503, body: `network ${e.cause?.code || e.name}` };
    }
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 2000) };
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: 502, body: 'invalid json' };
    }
    return { ok: true, data: parseIngredients(body) };
  };
