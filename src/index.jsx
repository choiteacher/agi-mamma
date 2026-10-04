import React from 'react';
import { createRoot } from 'react-dom/client';

// project import
import Gate from './gate/Gate';

// 처음에는 비밀번호 화면만 마운트한다. 실제 앱은 잠금 해제 후 Gate 안에서 lazy import 된다.
const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Gate />);
