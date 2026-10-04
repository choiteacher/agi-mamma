import React, { useState } from 'react';

// react-bootstrap
import { Button, Card, Col, Form, Row } from 'react-bootstrap';

// project import
import { DishLabel } from '../components/plan/SessionCard';
import { SETS, useAppData } from '../state/AppDataContext';

// ==============================|| 레시피 ||============================== //
// 식단 세트별 요리 목록. 요리명을 누르면 레시피 팝업, 마우스를 1초 올리면(휴대폰은 ⓘ) 간략 조리법.

const Recipes = () => {
  const months = [...new Set(SETS.map((s) => s.month))];
  const [month, setMonth] = useState(months[0]);
  const sets = SETS.filter((s) => s.month === month);
  const { settings, toggleFavorite } = useAppData();
  const favorites = settings.favorites || [];
  return (
    <Row>
      <Col sm={12}>
        <Form.Select
          className="mb-3"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          style={{ maxWidth: 240 }}
          aria-label="기준 달"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}월 식단 세트 ({SETS.filter((s) => s.month === m).length})
            </option>
          ))}
        </Form.Select>
        {sets.map((set) => (
          <Card key={set.id} className="mb-3">
            <Card.Body className="py-2">
              <div className="d-flex align-items-start justify-content-between">
                <div className="small text-muted mb-1">
                  {set.source} {set.ref_month} {set.slot} 식단 · {set.protein} · 약 {set.active_minutes}분
                </div>
                <Button
                  variant="link"
                  className="p-0 ms-2 text-warning text-decoration-none text-nowrap"
                  onClick={() => toggleFavorite(set.id)}
                  aria-pressed={favorites.includes(set.id)}
                  title={`즐겨찾기 세트는 ${settings.favoriteReuseDays}일 뒤에 다시 만들 수 있어요`}
                >
                  {favorites.includes(set.id) ? '★ 즐겨찾기' : '☆ 즐겨찾기'}
                </Button>
              </div>
              <ul className="list-unstyled mb-0">
                {set.dishes.map((d, i) => (
                  <li key={i} className="py-1">
                    <DishLabel dish={d} />
                  </li>
                ))}
              </ul>
            </Card.Body>
          </Card>
        ))}
        <p className="small text-muted">
          레시피는 성인 약 5인분 기준이며 모두 검증 전입니다. 보관 기간과 권장 월령은 근거를 확인하기 전까지 &quot;확인 필요&quot;로
          표시합니다.
        </p>
      </Col>
    </Row>
  );
};

export default Recipes;
