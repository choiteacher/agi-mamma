import React from 'react';

// project import
import { lockNow } from './lock';

// ==============================|| LOCK BUTTON ||============================== //

const LockButton = ({ className = '' }) => (
  <button type="button" className={'gate-lock-button ' + className} onClick={lockNow} title="이 기기에서 잠그기">
    <i className="feather icon-lock" />
    <span>잠그기</span>
  </button>
);

export default LockButton;
