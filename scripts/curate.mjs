// npm run curate: 로컬 영상 선택 화면을 띄운다(개발 서버 + 로컬 전용 미들웨어).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

process.env.CURATE = '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { host: 'localhost', open: '/__curate/' } });
await server.listen();
console.log('\n영상 고르기 화면: http://localhost:' + server.config.server.port + '/__curate/  (이 PC에서만 열림, 끝내려면 Ctrl+C)\n');
