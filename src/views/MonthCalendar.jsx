import React from 'react';

// react-bootstrap
import { Col, Row } from 'react-bootstrap';

// project import
import MainCard from '../components/Card/MainCard';
import { STATUS } from '../components/plan/SessionCard';
import { setTitle, setsById, useAppData } from '../state/AppDataContext';
import { WEEKDAY_KO, addDays, monthOf, rangeDays, weekStart } from '../lib/dates';

// ==============================|| 월간 캘린더 ||============================== //

const MonthGrid = ({ month, sessionsByDate, today }) => {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const days = rangeDays(weekStart(first), addDays(weekStart(last), 6));
  // 월요일 시작
  const heads = [1, 2, 3, 4, 5, 6, 0].map((w) => WEEKDAY_KO[w]);
  return (
    <MainCard title={`${y}년 ${m}월`}>
      <div className="cal-grid">
        {heads.map((h) => (
          <div key={h} className="cal-head">
            {h}
          </div>
        ))}
        {days.map((d) => {
          const s = sessionsByDate.get(d);
          const inMonth = monthOf(d) === m;
          return (
            <div key={d} className={`cal-cell ${inMonth ? '' : 'cal-out'} ${d === today ? 'cal-today' : ''}`}>
              <div className="cal-day">{Number(d.slice(8))}</div>
              {inMonth && s && (
                <div className={`cal-session cal-${s.status}`} title={s.setId ? setTitle(setsById.get(s.setId)) : s.reason || ''}>
                  {s.setId ? setTitle(setsById.get(s.setId)) : STATUS[s.status]?.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </MainCard>
  );
};

const MonthCalendar = () => {
  const { today, plan } = useAppData();
  const sessionsByDate = new Map(plan.sessions.map((s) => [s.date, s]));
  const months = [plan.horizon.start.slice(0, 7), plan.horizon.end.slice(0, 7)];
  return (
    <Row>
      <Col sm={12}>
        {months.map((m) => (
          <MonthGrid key={m} month={m} sessionsByDate={sessionsByDate} today={today} />
        ))}
        <p className="small text-muted">이번 달과 다음 달 일정만 만듭니다. 달이 바뀌면 자동으로 다음 달이 추가됩니다.</p>
      </Col>
    </Row>
  );
};

export default MonthCalendar;
