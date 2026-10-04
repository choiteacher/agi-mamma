import React from 'react';

// react-bootstrap
import { Badge, Button, Col, Form, Row, Table } from 'react-bootstrap';

// project import
import MainCard from '../components/Card/MainCard';
import { setTitle, setsById, useAppData } from '../state/AppDataContext';
import { formatKo } from '../lib/dates';

// ==============================|| 재고(냉장·냉동) ||============================== //

const Stock = () => {
  const { stock, plan, updateStockPortions, deleteStock } = useAppData();
  const rows = stock
    .map((s) => ({ ...s, remaining: plan.stockRemaining[s.id] ?? s.portions }))
    .filter((s) => s.remaining > 0)
    .sort((a, b) => (a.location === b.location ? (a.date < b.date ? -1 : 1) : a.location === 'fridge' ? -1 : 1));

  return (
    <Row>
      <Col sm={12}>
        <MainCard title="냉장·냉동 재고 (아이 끼니 수 기준)">
          {rows.length === 0 && (
            <p className="text-muted mb-0">재고가 없습니다. 요리를 마치고 &quot;재고에 넣기&quot;를 누르면 여기에 쌓입니다.</p>
          )}
          {rows.length > 0 && (
            <Table responsive size="sm">
              <thead>
                <tr>
                  <th>보관</th>
                  <th>식단</th>
                  <th>만든 날</th>
                  <th>남은 끼니</th>
                  <th>보관 기간</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Badge bg={s.location === 'fridge' ? 'info' : 'primary'}>{s.location === 'fridge' ? '냉장' : '냉동'}</Badge>
                    </td>
                    <td>{setTitle(setsById.get(s.setId))}</td>
                    <td className="text-nowrap">{formatKo(s.date)}</td>
                    <td>
                      <Form.Control
                        type="number"
                        inputMode="numeric"
                        size="sm"
                        min={0}
                        value={s.remaining}
                        onChange={(e) => updateStockPortions(s.id, Number(e.target.value))}
                        style={{ width: 70 }}
                        aria-label="남은 끼니 수"
                      />
                    </td>
                    <td>
                      <Badge bg="warning" text="dark">
                        확인 필요
                      </Badge>
                    </td>
                    <td>
                      <Button size="sm" variant="outline-danger" onClick={() => deleteStock(s.id)}>
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="small text-muted mb-0">
            남은 끼니는 먹일 끼니표대로 먹었다고 보고 자동으로 줄어듭니다. 실제와 다르면 숫자를 고쳐 주세요. 보관 가능 기간은 근거 자료를
            확인하기 전까지 &quot;확인 필요&quot;로 표시합니다.
          </p>
        </MainCard>
      </Col>
    </Row>
  );
};

export default Stock;
