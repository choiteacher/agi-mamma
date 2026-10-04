import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';

// project import
import './gate.css';
import { getGateConfig } from './gateConfig';
import { isCryptoAvailable, verifyPassword } from './crypto';
import { clearFailures, isRemembered, readFailures, readNumericPref, recordFailure, rememberUnlock, writeNumericPref } from './storage';

// 실제 앱은 잠금 해제 전에는 내려받지도 않는다.
const AppRoot = lazy(() => import('../AppRoot'));

// ==============================|| GATE ||============================== //

const Gate = () => {
  const gate = getGateConfig();
  const [unlocked, setUnlocked] = useState(() => !!gate && isRemembered(gate));

  if (unlocked) {
    return (
      <Suspense fallback={<div className="gate-loading">여는 중…</div>}>
        <AppRoot />
      </Suspense>
    );
  }

  return (
    <div className="gate">
      <div className="gate-backdrop" aria-hidden="true">
        <span className="gate-blob gate-blob-1" />
        <span className="gate-blob gate-blob-2" />
        <span className="gate-blob gate-blob-3" />
      </div>
      <div className="gate-veil" aria-hidden="true" />
      <main className="gate-card">
        <div className="gate-pigs" aria-hidden="true">
          🐷🐷🐷
        </div>
        <h1 className="gate-title">아기돼지 삼형제</h1>
        {!gate && <SetupNotice />}
        {gate && !isCryptoAvailable() && <InsecureNotice />}
        {gate && isCryptoAvailable() && <LockForm gate={gate} onUnlock={() => setUnlocked(true)} />}
      </main>
    </div>
  );
};

const SetupNotice = () => (
  <p className="gate-message">
    아직 비밀번호가 설정되지 않았습니다.
    <br />
    터미널에서 <code>npm run set-password</code> 를 실행하세요.
  </p>
);

const InsecureNotice = () => (
  <p className="gate-message">
    이 주소에서는 비밀번호를 확인할 수 없습니다.
    <br />
    https 주소 또는 이 PC의 localhost 로 접속하세요.
  </p>
);

const LockForm = ({ gate, onUnlock }) => {
  const inputRef = useRef(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waitUntil, setWaitUntil] = useState(() => readFailures().waitUntil);
  const [now, setNow] = useState(() => Date.now());
  const [numeric, setNumeric] = useState(() => readNumericPref());

  const waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const waiting = waitSeconds > 0;

  // 대기 중에는 1초마다 남은 시간을 갱신하고, 끝나면 입력칸에 다시 초점을 준다.
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    if (!waiting && !busy && inputRef.current) inputRef.current.focus();
  }, [waiting, busy]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy || waiting || !password) return;
    setBusy(true);
    setError('');
    const ok = await verifyPassword(password, gate);
    if (ok) {
      clearFailures();
      rememberUnlock(gate);
      onUnlock();
      return;
    }
    const failure = recordFailure();
    setPassword('');
    setWaitUntil(failure.waitUntil);
    setNow(Date.now());
    setError('비밀번호가 맞지 않습니다.');
    setBusy(false);
  };

  const toggleNumeric = () => {
    writeNumericPref(!numeric);
    setNumeric(!numeric);
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <form className="gate-form" onSubmit={handleSubmit}>
      {/* 비밀번호 관리자가 이 사이트의 저장 항목을 구분할 수 있도록 고정된 사용자 이름을 둔다. */}
      <input className="gate-sr-only" type="text" name="username" autoComplete="username" value="agi-mamma" readOnly tabIndex={-1} />
      <label className="gate-label" htmlFor="gate-password">
        비밀번호
      </label>
      <input
        ref={inputRef}
        id="gate-password"
        className="gate-input"
        type="password"
        name="password"
        autoComplete="current-password"
        inputMode={numeric ? 'numeric' : undefined}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy || waiting}
        aria-describedby="gate-status"
      />
      <button className="gate-button" type="submit" disabled={busy || waiting || !password}>
        {busy ? '확인 중…' : waiting ? `${waitSeconds}초 후 다시 시도` : '열기'}
      </button>
      <p id="gate-status" className="gate-status" aria-live="polite">
        {error}
      </p>
      <div className="gate-footer">
        <button type="button" className="gate-link" onClick={toggleNumeric} aria-pressed={numeric}>
          {numeric ? '일반 키보드로 입력' : '숫자 키패드로 입력'}
        </button>
        <span>이 기기에서 30일 동안 기억합니다.</span>
      </div>
    </form>
  );
};

export default Gate;
