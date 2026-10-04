// Gemini로 유튜브 영상 요약 (내 PC 스크립트 전용)
// 공식 문서(video-understanding): 유튜브 URL 입력은 미리보기 기능, 공개 영상만, 무료 등급은 하루 8시간 분량까지.
// 요청은 generateContent + file_data.file_uri 형식. 모델 이름은 GEMINI_MODEL 환경변수로 바꿀 수 있다(기본값 확인 필요).
// 공식 문서(2026-10 확인)의 예시 모델. 바뀌면 GEMINI_MODEL 환경변수로 지정
export const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export const SUMMARY_PROMPT = (
  dishName
) => `이 영상은 "${dishName}" 만드는 법 영상입니다. 34개월(약 3살) 아이와 가족이 함께 먹는 요리로 참고하려고 합니다.
영상에서 실제로 보이거나 들리는 내용만 한국어로 정리하세요. 영상에서 확인할 수 없는 내용은 지어내지 말고 "영상에서 확인 불가"라고 쓰세요.
다음 JSON 형식으로만 답하세요:
{
  "ingredients": ["재료와 양 (영상에 나온 그대로)", ...],
  "steps": ["조리 순서를 짧은 문장으로", ...],
  "cautions": ["34개월 아이에게 줄 때 주의할 점: 간(짠맛), 매운 양념, 질식 위험이 있는 모양·크기(통견과, 동그란 모양, 질긴 것), 가시, 꿀(이 나이에도 확인), 덜 익힘 등. 영상 기준으로 해당되는 것만", ...],
  "unverifiable": ["영상에서 확인 불가한 항목", ...]
}
cautions 항목은 반드시 1개 이상 쓰세요. 해당 사항이 없으면 "영상 기준 특별한 주의점 없음(간은 아이 몫을 먼저 덜고 하기)"이라고 쓰세요.`;

export function buildRequest(videoUrl, dishName) {
  return {
    contents: [{ role: 'user', parts: [{ file_data: { file_uri: videoUrl } }, { text: SUMMARY_PROMPT(dishName) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
  };
}

// 응답에서 텍스트를 꺼내 JSON으로. 형식이 어긋나면 null
export function parseSummary(body) {
  const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') || body?.output_text || '';
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return null;
  try {
    const s = JSON.parse(json[0]);
    const arr = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 20) : []);
    const out = { ingredients: arr(s.ingredients), steps: arr(s.steps), cautions: arr(s.cautions), unverifiable: arr(s.unverifiable) };
    if (!out.cautions.length) out.cautions = ['영상에서 확인 불가'];
    return out;
  } catch {
    return null;
  }
}

// KeyPool.call 에 넘길 요청 함수 (키 값은 헤더로만 보내고 어디에도 남기지 않는다)
export const summarizeRequest =
  (videoUrl, dishName, { model = DEFAULT_MODEL, fetchImpl = fetch } = {}) =>
  async (apiKey) => {
    let res;
    try {
      res = await fetchImpl(ENDPOINT(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildRequest(videoUrl, dishName))
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
    return { ok: true, data: parseSummary(body) };
  };
