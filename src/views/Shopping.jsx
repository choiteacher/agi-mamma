import React, { useEffect, useMemo, useState } from 'react';

// react-bootstrap
import { Button, ButtonGroup, Col, Form, Row } from 'react-bootstrap';

// project import
import MainCard from '../components/Card/MainCard';
import { recipesById, setTitle, setsById, useAppData } from '../state/AppDataContext';
import { addDays, formatKo } from '../lib/dates';
import { buildShoppingList } from '../lib/shopping';
import { createLocalStorageAdapter } from '../lib/storage';

// ==============================|| 장보기 목록 ||============================== //

const RANGES = [
  ['next', '다음 요리'],
  ['week', '7일'],
  ['twoWeeks', '14일']
];
// 체크 표시는 이 기기에서만 쓰는 편의 기능(공유/백업 대상 아님)
const local = createLocalStorageAdapter(undefined, 'agi-mamma.ui.');

const ItemRow = ({ item, checked, onToggle }) => (
  <li className="py-1">
    <Form.Check
      id={`shop-${item.key}`}
      type="checkbox"
      checked={!!checked}
      onChange={onToggle}
      label={
        <span className={checked ? 'text-decoration-line-through text-muted' : ''}>
          <strong>{item.name}</strong>{' '}
          <small className="text-muted">
            {item.uses
              .map((u) => `${u.amount ? u.amount + ' ' : ''}${u.dish}(${formatKo(u.date)})`)
              .filter((x, i, arr) => arr.indexOf(x) === i)
              .join(', ')}
          </small>
        </span>
      }
    />
  </li>
);

const Shopping = () => {
  const { plan, today } = useAppData();
  const [range, setRange] = useState(() => local.load('shoppingRange', 'next'));
  const [checked, setChecked] = useState(() => local.load('shoppingChecked', {}));
  useEffect(() => void local.save('shoppingRange', range), [range]);
  useEffect(() => void local.save('shoppingChecked', checked), [checked]);

  const sessions = useMemo(() => {
    const upcoming = plan.sessions.filter((s) => s.date >= today && s.setId && (s.status === 'planned' || s.status === 'cooking'));
    if (range === 'next') return upcoming.slice(0, 1);
    const until = addDays(today, range === 'week' ? 6 : 13);
    return upcoming.filter((s) => s.date <= until);
  }, [plan, today, range]);

  const list = useMemo(() => buildShoppingList(sessions, setsById, recipesById), [sessions]);
  const toggle = (key) => setChecked((c) => ({ ...c, [key]: !c[key] }));

  return (
    <Row>
      <Col sm={12}>
        <ButtonGroup className="mb-3">
          {RANGES.map(([key, label]) => (
            <Button key={key} variant={range === key ? 'primary' : 'outline-primary'} onClick={() => setRange(key)}>
              {label}
            </Button>
          ))}
        </ButtonGroup>
        <MainCard title="요리할 식단">
          {sessions.length === 0 && <p className="text-muted mb-0">이 기간에 예정된 요리가 없습니다.</p>}
          <ul className="mb-0">
            {sessions.map((s) => (
              <li key={s.date}>
                {formatKo(s.date)} · {setTitle(setsById.get(s.setId))}
              </li>
            ))}
          </ul>
        </MainCard>
        {sessions.length > 0 && (
          <>
            <MainCard title={`살 것 (${list.buy.length})`}>
              <ul className="list-unstyled mb-0">
                {list.buy.map((i) => (
                  <ItemRow key={i.key} item={i} checked={checked[i.key]} onToggle={() => toggle(i.key)} />
                ))}
              </ul>
            </MainCard>
            <MainCard title={`집에 있는지 확인 (${list.pantry.length})`}>
              <ul className="list-unstyled mb-0">
                {list.pantry.map((i) => (
                  <ItemRow key={i.key} item={i} checked={checked[i.key]} onToggle={() => toggle(i.key)} />
                ))}
              </ul>
            </MainCard>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <Button size="sm" variant="outline-secondary" onClick={() => setChecked({})}>
                체크 모두 지우기
              </Button>
              <small className="text-muted">양은 성인 약 5인분 레시피 기준입니다. 체크 표시는 이 기기에만 저장됩니다.</small>
            </div>
          </>
        )}
      </Col>
    </Row>
  );
};

export default Shopping;
