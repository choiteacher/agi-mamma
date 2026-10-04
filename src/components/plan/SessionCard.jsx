import React, { useState } from 'react';

// react-bootstrap
import { Badge, Button, Card, Form } from 'react-bootstrap';

// project import
import { cookableDishes, recipesById, setsById, useAppData } from '../../state/AppDataContext';
import { formatKo } from '../../lib/dates';
import { RecipeName } from '../recipe/RecipeUi';

// ==============================|| SESSION CARD ||============================== //

export const STATUS = {
  planned: { label: '예정', bg: 'primary' },
  cooking: { label: '요리 중', bg: 'warning' },
  done: { label: '완료', bg: 'success' },
  rest: { label: '쉼', bg: 'secondary' },
  skipped: { label: '미룸', bg: 'secondary' }
};

const DIFFICULTY = ['', '쉬움', '보통', '어려움'];

const SessionCard = ({ session }) => {
  const { today, settings, logFor, toggleDish, completeSession, uncompleteSession, skipSession, clearLog } = useAppData();
  const set = session.setId ? setsById.get(session.setId) : null;
  const log = logFor(session.date);
  const status = STATUS[session.status] || STATUS.planned;
  const canCheck = session.date <= today && (session.status === 'planned' || session.status === 'cooking');
  const checked = new Set(log ? log.checked || [] : []);
  const dishes = set ? cookableDishes(set) : [];
  const allChecked = dishes.length > 0 && dishes.every((d) => checked.has(d.recipe_id));

  return (
    <Card className="session-card mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <strong>{formatKo(session.date)}</strong>
        <Badge bg={status.bg}>{status.label}</Badge>
        {session.date === today && <Badge bg="info">오늘</Badge>}
      </Card.Header>
      <Card.Body>
        {!set && session.status === 'rest' && <p className="mb-0 text-muted">요리 쉬는 날 · {session.reason}</p>}
        {!set && session.status === 'skipped' && (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="text-muted">이날 요리는 미뤘습니다. 다음 요리 요일로 넘어갑니다.</span>
            {session.date >= today && (
              <Button size="sm" variant="outline-secondary" onClick={() => clearLog(session.date)}>
                미루기 취소
              </Button>
            )}
          </div>
        )}
        {set && (
          <>
            <SetMeta set={set} session={session} settings={settings} />
            <ul className="list-unstyled set-dishes mb-2">
              {set.dishes.map((d, i) => (
                <li key={i} className="d-flex align-items-start gap-2 py-1">
                  {d.role === 'dish' ? (
                    <Form.Check
                      id={`chk-${session.date}-${i}`}
                      type="checkbox"
                      checked={checked.has(d.recipe_id) || session.status === 'done'}
                      disabled={!canCheck}
                      onChange={() => toggleDish(session.date, set.id, d.recipe_id)}
                      label={<DishLabel dish={d} />}
                    />
                  ) : (
                    <span className="ms-4">
                      <DishLabel dish={d} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {session.status === 'done' && log && (
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="text-success">
                  재고 등록: 냉장 {log.fridge || 0}끼 · 냉동 {log.freezer || 0}끼
                </span>
                {session.date >= today && (
                  <Button size="sm" variant="outline-secondary" onClick={() => uncompleteSession(session.date)}>
                    완료 취소
                  </Button>
                )}
              </div>
            )}
            {canCheck && allChecked && <CompleteForm session={session} set={set} settings={settings} onDone={completeSession} />}
            {(session.status === 'planned' || session.status === 'cooking') && session.date >= today && (
              <Button size="sm" variant="outline-danger" className="mt-2" onClick={() => skipSession(session.date)}>
                {session.date === today ? '오늘 못 했어요 (미루기)' : '이날 미루기'}
              </Button>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export const DishLabel = ({ dish }) => {
  const recipe = dish.recipe_id ? recipesById.get(dish.recipe_id) : null;
  return (
    <span>
      {recipe ? (
        <RecipeName recipeId={recipe.id}>{dish.name}</RecipeName>
      ) : (
        <span className={dish.role === 'base' ? 'text-muted' : ''}>{dish.name}</span>
      )}
      {dish.note && dish.role !== 'base' && (
        <Badge bg="light" text="dark" className="ms-1 border">
          {dish.note}
        </Badge>
      )}
      {dish.role === 'base' && dish.note && <small className="text-muted ms-1">· {dish.note}</small>}
      {recipe && recipe.difficulty >= 3 && (
        <Badge bg="danger" className="ms-1">
          어려움
        </Badge>
      )}
    </span>
  );
};

const SetMeta = ({ set, session }) => (
  <div className="set-meta small text-muted mb-2">
    <span>약 {set.active_minutes}분</span>
    <span>난이도 {DIFFICULTY[set.difficulty_max]}</span>
    <span>{set.all_freezable ? '전부 냉동 가능' : set.freezable ? '일부 냉동 가능' : '냉동 어려움'}</span>
    {session.servedFrom && (
      <span>
        먹일 기간 {formatKo(session.servedFrom)}~{formatKo(session.servedTo)}
      </span>
    )}
    {session.split && (
      <span>
        제안: 아이 기준 냉장 {session.split.fridge}끼{session.split.freezer ? ` · 냉동 ${session.split.freezer}끼` : ''}
        {session.split.leftover ? ` · 남는 ${session.split.leftover}끼분은 어른 몫` : ''}
      </span>
    )}
  </div>
);

const CompleteForm = ({ session, set, settings, onDone }) => {
  const total = settings.childMealsPerSet;
  const [fridge, setFridge] = useState(set.freezable ? 1 : total);
  const [freezer, setFreezer] = useState(set.freezable ? total - 1 : 0);
  return (
    <div className="complete-form border rounded p-2 mb-2">
      <div className="mb-2">다 만들었어요! 아이 몫을 어디에 보관할까요? (끼니 수)</div>
      <div className="d-flex gap-3 flex-wrap align-items-end">
        <Form.Group>
          <Form.Label className="small mb-0">냉장</Form.Label>
          <Form.Control
            type="number"
            inputMode="numeric"
            min={0}
            value={fridge}
            onChange={(e) => setFridge(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label className="small mb-0">냉동</Form.Label>
          <Form.Control
            type="number"
            inputMode="numeric"
            min={0}
            value={freezer}
            disabled={!set.freezable}
            onChange={(e) => setFreezer(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </Form.Group>
        <Button onClick={() => onDone(session.date, set.id, { fridge, freezer })}>재고에 넣기</Button>
      </div>
      {!set.all_freezable && set.freezable && (
        <div className="small text-muted mt-1">나물·무침 등 냉동이 어려운 요리는 냉동분에서 빠질 수 있어요.</div>
      )}
    </div>
  );
};

export default SessionCard;
