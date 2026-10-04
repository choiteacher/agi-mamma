import React, { useState } from 'react';

// react-bootstrap
import { Badge, Button, Col, Row, Table } from 'react-bootstrap';

// project import
import MainCard from '../components/Card/MainCard';
import Assumptions from '../components/plan/Assumptions';
import { setTitle, setsById, useAppData } from '../state/AppDataContext';
import { formatKo } from '../lib/dates';

// ==============================|| 먹일 끼니표 ||============================== //

const SOURCE = {
  fresh: { label: '요리한 날', bg: 'success' },
  fridge: { label: '냉장', bg: 'info' },
  freezer: { label: '냉동', bg: 'primary' }
};

const MealTable = () => {
  const { plan, today } = useAppData();
  const [days, setDays] = useState(14);
  const byDate = new Map();
  for (const m of plan.meals) byDate.set(m.date, [...(byDate.get(m.date) || []), m]);
  const dates = [...byDate.keys()].slice(0, days);

  return (
    <Row>
      <Col sm={12}>
        <MainCard title="아이가 집에서 먹는 끼니 (평일 아침·저녁, 주말 세 끼)">
          <Table responsive size="sm" className="meal-table mb-2">
            <tbody>
              {dates.map((d) => (
                <tr key={d} className={d === today ? 'table-info' : ''}>
                  <th className="text-nowrap">{formatKo(d)}</th>
                  <td>
                    {byDate.get(d).map((m) => (
                      <div key={m.slot} className="meal-row">
                        <span className="meal-slot">{m.slot}</span>
                        {m.setId ? (
                          <>
                            <span>{setTitle(setsById.get(m.setId))}</span>
                            <Badge bg={SOURCE[m.source].bg} className="ms-1">
                              {SOURCE[m.source].label}
                            </Badge>
                            {m.repeat && (
                              <Badge bg="light" text="dark" className="ms-1 border">
                                어제와 같음
                              </Badge>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">재고 없음 (간단식/외식)</span>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {dates.length < byDate.size && (
            <Button size="sm" variant="outline-primary" onClick={() => setDays(days + 14)}>
              2주 더 보기
            </Button>
          )}
        </MainCard>
        <Assumptions />
      </Col>
    </Row>
  );
};

export default MealTable;
