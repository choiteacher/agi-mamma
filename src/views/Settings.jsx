import React, { useRef, useState } from 'react';

// react-bootstrap
import { Alert, Button, Col, Form, Row } from 'react-bootstrap';

// project import
import MainCard from '../components/Card/MainCard';
import { useAppData } from '../state/AppDataContext';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { WEEKDAY_KO } from '../lib/dates';
import { decodeShareCode, describeSummary, encodeShareCode, validateImport } from '../lib/sync';

// ==============================|| 설정 ||============================== //

const NUMBER_FIELDS = [
  ['childMealsPerSet', '한 세트로 아이가 먹는 끼니 수', '성인 약 5인분 한 세트에서 아이 몫으로 나오는 끼니 수 [가안]'],
  ['fridgeDays', '냉장분을 먹이는 기간(일)', '이 기간이 지난 몫은 냉동하거나 어른 몫으로 [가안]'],
  ['lookaheadDays', '재고 충분 판단 기간(일)', '이만큼의 끼니가 재고로 채워지면 요리를 쉼'],
  ['minStockVariety', '쉬려면 필요한 세트 종류 수', '같은 세트를 연달아 먹이지 않으려면 여러 세트가 필요'],
  ['reuseBanDays', '같은 세트 다시 만들기 금지(일)', ''],
  ['favoriteReuseDays', '즐겨찾기 세트 다시 만들기 금지(일)', '']
];

const CookSettings = () => {
  const { settings, updateSettings, resetSettings } = useAppData();
  const toggleDay = (w) => {
    const set = new Set(settings.cookWeekdays);
    if (set.has(w)) set.delete(w);
    else set.add(w);
    updateSettings({ cookWeekdays: [...set].sort() });
  };
  return (
    <MainCard title="요리 설정">
      <Form.Group className="mb-3">
        <Form.Label>요리하는 요일</Form.Label>
        <div className="d-flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => (
            <Form.Check
              key={w}
              id={`cook-day-${w}`}
              type="checkbox"
              label={WEEKDAY_KO[w]}
              checked={settings.cookWeekdays.includes(w)}
              onChange={() => toggleDay(w)}
            />
          ))}
        </div>
      </Form.Group>
      <Row>
        {NUMBER_FIELDS.map(([key, label, help]) => (
          <Col md={6} key={key}>
            <Form.Group className="mb-3" controlId={`set-${key}`}>
              <Form.Label>{label}</Form.Label>
              <Form.Control
                type="number"
                inputMode="numeric"
                min={1}
                value={settings[key]}
                onChange={(e) => updateSettings({ [key]: Math.max(1, Number(e.target.value) || DEFAULT_SETTINGS[key]) })}
              />
              {help && <Form.Text muted>{help}</Form.Text>}
            </Form.Group>
          </Col>
        ))}
      </Row>
      <Form.Group className="mb-3" controlId="set-avoid">
        <Form.Label>기피 재료 (쉼표로 구분)</Form.Label>
        <Form.Control
          type="text"
          placeholder="예: 오징어, 가지"
          defaultValue={settings.avoidIngredients.join(', ')}
          onBlur={(e) =>
            updateSettings({
              avoidIngredients: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            })
          }
        />
        <Form.Text muted>이 재료가 들어간 식단 세트는 고르지 않습니다(입력칸을 벗어나면 저장).</Form.Text>
      </Form.Group>
      <Button variant="outline-secondary" size="sm" onClick={resetSettings}>
        기본값으로 되돌리기
      </Button>
    </MainCard>
  );
};

// 가져오기 공통: 미리보기 → 확인 → 적용
const ImportPreview = ({ pending, onApply, onCancel }) => (
  <Alert variant="info" className="mt-2">
    <div className="fw-bold mb-1">가져오면 이렇게 바뀝니다</div>
    <ul className="mb-2">
      {describeSummary(pending.summary).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
    <div className="d-flex gap-2">
      <Button size="sm" onClick={onApply}>
        적용
      </Button>
      <Button size="sm" variant="outline-secondary" onClick={onCancel}>
        취소
      </Button>
    </div>
  </Alert>
);

const ShareCode = () => {
  const { exportData, previewImport, applyMerged, markBackup } = useAppData();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const makeCode = async () => {
    setCode(await encodeShareCode(exportData()));
    setCopied(false);
    markBackup();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('복사하지 못했습니다. 코드 칸을 길게 눌러 직접 복사해 주세요.');
    }
  };
  const check = async () => {
    setError('');
    setDone('');
    try {
      setPending(previewImport(await decodeShareCode(input)));
    } catch (e) {
      setPending(null);
      setError(e.message);
    }
  };

  return (
    <MainCard title="부부 공유 코드">
      <p className="small text-muted">
        서버 없이 기기끼리 데이터를 맞춥니다. 한쪽에서 코드를 만들어 메신저로 보내고, 다른 쪽에서 붙여 넣으세요. 같은 기록은 더 최근에 고친
        쪽을 남깁니다.
      </p>
      <Button onClick={makeCode} className="mb-2">
        공유 코드 만들기
      </Button>
      {code && (
        <>
          <Form.Control as="textarea" rows={3} readOnly value={code} onFocus={(e) => e.target.select()} aria-label="공유 코드" />
          <Button size="sm" variant="outline-primary" className="mt-2" onClick={copy}>
            {copied ? '복사했어요' : '코드 복사'}
          </Button>
        </>
      )}
      <hr />
      <Form.Group controlId="share-input">
        <Form.Label>받은 공유 코드 붙여 넣기</Form.Label>
        <Form.Control as="textarea" rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="AGM1.로 시작하는 코드" />
      </Form.Group>
      <Button size="sm" className="mt-2" onClick={check} disabled={!input.trim()}>
        가져오기 미리보기
      </Button>
      {error && (
        <Alert variant="danger" className="mt-2 mb-0">
          {error}
        </Alert>
      )}
      {pending && (
        <ImportPreview
          pending={pending}
          onApply={() => {
            applyMerged(pending.merged);
            setPending(null);
            setInput('');
            setDone('가져오기를 적용했습니다.');
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {done && (
        <Alert variant="success" className="mt-2 mb-0">
          {done}
        </Alert>
      )}
    </MainCard>
  );
};

const Backup = () => {
  const { exportData, previewImport, applyMerged, markBackup, meta, today } = useAppData();
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const download = () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agi-mamma-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markBackup();
  };
  const onFile = async (e) => {
    setError('');
    setDone('');
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setPending(previewImport(validateImport(JSON.parse(await file.text()))));
    } catch (err) {
      setPending(null);
      setError(err instanceof SyntaxError ? 'JSON 파일을 읽지 못했습니다.' : err.message);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <MainCard title="백업 / 복원">
      <p className="small text-muted mb-2">
        데이터는 이 기기의 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라지니 가끔 파일로 백업해 두세요.
        {meta.lastBackupAt ? ` 마지막 백업: ${meta.lastBackupAt.slice(0, 10)}` : ' 아직 백업한 적이 없습니다.'}
      </p>
      <p className="small text-muted mb-2">
        레시피 영상에 누른 👍/👎 도 백업 파일에 들어갑니다. 이 파일을 PC로 옮겨 <code>npm run apply-ratings -- 파일이름.json</code> 을
        실행하면 영상 고르는 기준에 반영되고, 커밋·push 하면 두 사람 기기 모두에 적용됩니다.
      </p>
      <div className="d-flex gap-2 flex-wrap">
        <Button onClick={download}>백업 파일 저장</Button>
        <Button variant="outline-primary" onClick={() => fileRef.current && fileRef.current.click()}>
          백업 파일에서 복원
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>
      {error && (
        <Alert variant="danger" className="mt-2 mb-0">
          {error}
        </Alert>
      )}
      {pending && (
        <ImportPreview
          pending={pending}
          onApply={() => {
            applyMerged(pending.merged);
            setPending(null);
            setDone('복원을 적용했습니다. (지금 데이터와 합쳐집니다)');
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {done && (
        <Alert variant="success" className="mt-2 mb-0">
          {done}
        </Alert>
      )}
    </MainCard>
  );
};

const Settings = () => (
  <Row>
    <Col sm={12}>
      <CookSettings />
      <ShareCode />
      <Backup />
    </Col>
  </Row>
);

export default Settings;
