import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import jsconfigPaths from 'vite-jsconfig-paths';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { curatePlugin } from './scripts/lib/curate.mjs';

// GitHub Pages 주소(https://choiteacher.github.io/agi-mamma/)에 맞춘 경로
const BASE = '/agi-mamma/';

// gate.json(비밀번호 해시)이 없으면 개발 실행/빌드 때 안내한다. 화면에도 설정 안내가 뜬다.
const gateCheck = () => ({
  name: 'gate-check',
  buildStart() {
    if (process.env.VITEST) return;
    if (!fs.existsSync(fileURLToPath(new URL('./src/config/gate.json', import.meta.url)))) {
      console.warn('\n[gate] src/config/gate.json 이 없습니다. 비밀번호 화면이 "설정 안내"만 보여줍니다.');
      console.warn('[gate] 터미널에서 npm run set-password 를 실행해 비밀번호를 설정하세요.\n');
    }
  }
});

export default defineConfig({
  server: {
    // this ensures that the browser opens upon server start
    open: true,
    // this sets a default port to 3000
    port: 3000
  },
  define: {
    global: 'window'
  },
  css: {
    preprocessorOptions: {
      scss: {
        charset: false
      }
    },
    charset: false,
    postcss: {
      plugins: [
        {
          postcssPlugin: 'internal:charset-removal',
          AtRule: {
            charset: (atRule) => {
              if (atRule.name === 'charset') {
                atRule.remove();
              }
            }
          }
        }
      ]
    }
  },
  base: BASE,
  // 영상 고르기 화면은 npm run curate(CURATE=1) 개발 서버에서만. 빌드에는 포함되지 않는다.
  plugins: [react(), jsconfigPaths(), gateCheck(), ...(process.env.CURATE === '1' ? [curatePlugin({ root: fileURLToPath(new URL('.', import.meta.url)) })] : [])]
});
