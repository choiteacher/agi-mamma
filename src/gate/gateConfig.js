import { isValidGate } from './crypto';

// gate.json은 `npm run set-password`로 만든다. 파일이 없어도 빌드가 깨지지 않도록 glob으로 선택적으로 읽는다.
const files = import.meta.glob('../config/gate.json', { eager: true, import: 'default' });
const gate = Object.values(files)[0] || null;

export const getGateConfig = () => (isValidGate(gate) ? gate : null);
