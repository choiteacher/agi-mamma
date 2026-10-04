import React from 'react';

// react-bootstrap
import { Col, Row } from 'react-bootstrap';

// project import
import SessionCard from '../components/plan/SessionCard';
import Assumptions from '../components/plan/Assumptions';
import { useAppData } from '../state/AppDataContext';
import { addDays, weekStart } from '../lib/dates';

// ==============================|| 이번 주 요리일정 ||============================== //

const WeekPlan = () => {
  const { today, plan } = useAppData();
  const start = weekStart(today);
  const end = addDays(start, 6);
  let list = plan.sessions.filter((s) => s.date >= start && s.date <= end);
  // 이번 주에 남은 요리가 없으면(주말 등) 다음 주 첫 세션까지 보여 준다
  if (!list.some((s) => s.date >= today && s.setId)) {
    const next = plan.sessions.find((s) => s.date > end && s.setId);
    if (next) list = [...list, next];
  }

  return (
    <Row>
      <Col sm={12}>
        {list.length === 0 && <p className="text-muted">이번 주 요리 일정이 없습니다.</p>}
        {list.map((s) => (
          <SessionCard key={s.date} session={s} />
        ))}
        <Assumptions />
      </Col>
    </Row>
  );
};

export default WeekPlan;
