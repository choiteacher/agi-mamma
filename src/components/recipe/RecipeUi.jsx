import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// react-bootstrap
import { Badge, Button, Col, Modal, Overlay, Popover, Row } from 'react-bootstrap';

// project import
import media from '../../data/recipe-media.json';
import aliasMap from '../../data/video-names.json';
import { recipesById, useAppData } from '../../state/AppDataContext';
import { chooseVideo, videoNames } from '../../lib/videoChoice';

// ==============================|| RECIPE UI ||============================== //
// - 데스크톱: 요리명에 1초 이상 마우스를 올리면 간략 조리법 말풍선, 벗어나면 닫힘
// - 터치 기기: 요리명 옆 ⓘ 를 탭하면 같은 말풍선
// - 요리명 클릭: 레시피 팝업(왼쪽 영상, 오른쪽 영상 요약·재료·조리법·월령 주의)

const HOVER_DELAY_MS = 1000;
const RecipeUiContext = createContext({ open: () => {} });

export const useRecipeUi = () => useContext(RecipeUiContext);

const canHover = () => {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return true;
  }
};

export function RecipeUiProvider({ children }) {
  const [recipeId, setRecipeId] = useState(null);
  const open = useCallback((id) => setRecipeId(id), []);
  return (
    <RecipeUiContext.Provider value={{ open }}>
      {children}
      <RecipeModal recipeId={recipeId} onClose={() => setRecipeId(null)} />
    </RecipeUiContext.Provider>
  );
}

const ShortSteps = ({ recipe }) => (
  <ol className="mb-0 ps-3 recipe-short">
    {recipe.steps_short.slice(0, 5).map((s, i) => (
      <li key={i}>{s}</li>
    ))}
  </ol>
);

// 요리명 (말풍선 + 팝업 열기)
export const RecipeName = ({ recipeId, children }) => {
  const recipe = recipesById.get(recipeId);
  const { open } = useRecipeUi();
  const target = useRef(null);
  const timer = useRef(null);
  const [show, setShow] = useState(false);
  const [hoverable] = useState(canHover);

  useEffect(() => () => clearTimeout(timer.current), []);
  if (!recipe) return <span>{children}</span>;

  const onEnter = () => {
    if (!hoverable) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(true), HOVER_DELAY_MS);
  };
  const onLeave = () => {
    clearTimeout(timer.current);
    if (hoverable) setShow(false);
  };
  const onClick = (e) => {
    // 체크박스 label 안에 있어도 체크가 바뀌지 않게
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(timer.current);
    setShow(false);
    open(recipeId);
  };
  const onInfo = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShow((v) => !v);
  };

  return (
    <>
      <button type="button" ref={target} className="recipe-name" onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onClick}>
        {children}
      </button>
      {!hoverable && (
        <button type="button" className="recipe-info" onClick={onInfo} aria-label={`${recipe.name} 간략 조리법`}>
          ⓘ
        </button>
      )}
      <Overlay target={target.current} show={show} placement="bottom" rootClose={!hoverable} onHide={() => setShow(false)}>
        <Popover className="recipe-popover">
          <Popover.Header as="div" className="small fw-bold">
            {recipe.name} · 성인 약 {recipe.servings}인분
          </Popover.Header>
          <Popover.Body className="small">
            <ShortSteps recipe={recipe} />
            <div className="text-muted mt-1">이름을 누르면 자세한 레시피가 열립니다.</div>
          </Popover.Body>
        </Popover>
      </Overlay>
    </>
  );
};

const NeedCheck = () => (
  <Badge bg="warning" text="dark">
    확인 필요
  </Badge>
);

// 👍/👎 는 누르는 즉시 이 기기에 저장된다. 👎 영상은 바로 다음 후보로 바뀌고, 같은 채널 영상의 순서에도 반영된다.
const RatingBar = ({ video, recipeId }) => {
  const { ratingMap, rateVideo } = useAppData();
  const current = ratingMap.get(video.videoId)?.rating || 0;
  const rate = (value) =>
    rateVideo({ videoId: video.videoId, recipeId, channelId: video.channelId, rating: current === value ? 0 : value });
  return (
    <div className="video-rating d-flex align-items-center gap-1 mt-1">
      <span className="small text-muted me-1">이 영상 어때요?</span>
      <Button
        size="sm"
        variant={current === 1 ? 'primary' : 'outline-secondary'}
        className="py-0 px-2"
        onClick={() => rate(1)}
        aria-pressed={current === 1}
        aria-label="좋아요"
        title="좋아요: 이 영상을 계속 보여 주고, 이 채널 영상을 더 앞에 둬요"
      >
        👍
      </Button>
      <Button
        size="sm"
        variant={current === -1 ? 'danger' : 'outline-secondary'}
        className="py-0 px-2"
        onClick={() => rate(-1)}
        aria-pressed={current === -1}
        aria-label="별로예요"
        title="별로예요: 다음 후보 영상으로 바꾸고, 이 채널 영상은 뒤로 미뤄요"
      >
        👎
      </Button>
    </div>
  );
};

const VideoPane = ({ video, recipeId, hasCandidates }) => {
  if (!video) {
    return (
      <div className="video-placeholder">
        <div>{hasCandidates ? '알맞은 영상이 없어요' : '영상 준비 중'}</div>
        <small className="text-muted">
          {hasCandidates
            ? '요리 이름이 맞는 후보가 없거나 후보를 모두 별로로 평가했어요. 글 레시피를 봐 주세요.'
            : '영상이 생기면 여기에 나옵니다.'}
        </small>
      </div>
    );
  }
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
  if (video.embeddable === false) {
    return (
      <div className="video-placeholder">
        <div>이 영상은 다른 사이트에서 재생할 수 없습니다.</div>
        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
          유튜브에서 보기
        </a>
        <RatingBar video={video} recipeId={recipeId} />
      </div>
    );
  }
  return (
    <div>
      <div className="ratio ratio-16x9">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}`}
          title={video.title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="small mt-1">
        {video.title} · {video.channel}{' '}
        <a href={watchUrl} target="_blank" rel="noopener noreferrer">
          유튜브에서 보기
        </a>
      </div>
      <RatingBar video={video} recipeId={recipeId} />
    </div>
  );
};

const SummaryList = ({ title, items, className = '' }) =>
  items && items.length ? (
    <>
      <div className="small fw-bold">{title}</div>
      <ul className={`small mb-1 ${className}`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </>
  ) : null;

// 아이는 매운 것을 못 먹는다. 영상 재료 중 매운 양념은 표시해 둔다(김치는 따로 씻어 먹이므로 제외).
const SPICY = /(고춧가루|고추장|청양|고추기름|칠리|핫소스|(?<!피)고추(?!냉이))/;

// 영상 "더보기"(설명란)에 유튜버가 적어 둔 재료. 영상 기준 양이라 아래 5인분 레시피와 다를 수 있다.
const VideoIngredients = ({ video }) => {
  if (!video || !video.descIngredients || !video.descIngredients.length) return null;
  return (
    <div className="mb-3 p-2 border rounded">
      <h6 className="mb-1">영상 속 재료 (영상 더보기란 참고)</h6>
      <ul className="small mb-1">
        {video.descIngredients.map((x, i) => (
          <li key={i}>
            {x}
            {SPICY.test(x) && (
              <Badge bg="danger" className="ms-1">
                매움 · 아이 몫은 빼기
              </Badge>
            )}
          </li>
        ))}
      </ul>
      <div className="small text-muted">
        영상 기준 양이라 아래 성인 5인분 레시피와 다를 수 있어요.{video.descSource === 'gemini' ? ' (설명란 글을 AI가 정리)' : ''}
      </div>
    </div>
  );
};

// 예전 방식(AI 영상 분석)으로 만든 요약. 새로 만들지는 않고, 설명란 재료가 없는 영상에만 남은 것을 보여 준다.
const VideoSummary = ({ video }) => {
  if (!video || !video.summary || (video.descIngredients && video.descIngredients.length)) return null;
  const s = video.summary;
  return (
    <div className="mb-3 p-2 border rounded">
      <h6 className="mb-1">영상 요약 (AI 요약 · 확인 필요)</h6>
      <SummaryList title="영상 속 재료" items={s.ingredients} />
      <SummaryList title="영상 속 순서" items={s.steps} />
      <SummaryList title="34개월 주의" items={s.cautions} className="text-danger" />
      <SummaryList title="영상에서 확인 불가" items={s.unverifiable} className="text-muted" />
    </div>
  );
};

function RecipeModal({ recipeId, onClose }) {
  const recipe = recipeId ? recipesById.get(recipeId) : null;
  const { ratingMap } = useAppData();
  const video = recipe ? chooseVideo(media[recipe.id], videoNames(recipe, aliasMap), ratingMap) : null;
  return (
    <Modal show={!!recipe} onHide={onClose} size="xl" fullscreen="md-down" centered scrollable>
      {recipe && (
        <>
          <Modal.Header closeButton>
            <Modal.Title as="h5">
              {recipe.name}
              {recipe.mild_version && (
                <Badge bg="light" text="dark" className="ms-2 border">
                  안 매운 버전
                </Badge>
              )}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col lg={6}>
                <VideoPane video={video} recipeId={recipe.id} hasCandidates={!!media[recipe.id]?.candidates?.length} />
              </Col>
              <Col lg={6}>
                <VideoIngredients video={video} />
                <VideoSummary video={video} />
                <div className="small text-muted mb-2">
                  성인 약 {recipe.servings}인분 · 손이 가는 시간 약 {recipe.active_minutes}분 · 냉동 {recipe.freezable ? '가능' : '어려움'}{' '}
                  · 냉장 보관 기간 <NeedCheck /> · 냉동 보관 기간 <NeedCheck /> · 권장 월령 <NeedCheck />
                </div>
                <h6>재료</h6>
                <ul className="mb-3">
                  {recipe.ingredients.map((i, k) => (
                    <li key={k}>
                      {i.item} {i.amount && <strong>{i.amount}</strong>}
                    </li>
                  ))}
                </ul>
                <h6>만드는 법</h6>
                <ol className="mb-3">
                  {recipe.steps_full.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ol>
                <div className="alert alert-warning small mb-2">34개월 주의: {recipe.safety_note}</div>
                <div className="small text-muted">
                  {recipe.source} · 검증 전 레시피입니다. 간은 아이 몫을 먼저 덜고 어른 몫에만 더하세요.
                </div>
              </Col>
            </Row>
          </Modal.Body>
        </>
      )}
    </Modal>
  );
}
