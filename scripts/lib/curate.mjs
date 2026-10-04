// 로컬 영상 선택 화면(npm run curate) - Vite 개발 서버 전용 미들웨어. 프로덕션 빌드에는 들어가지 않는다(apply: 'serve' + CURATE=1).
// 고른 영상은 src/data/recipe-media.json 의 picked 에, 고른 채널 가산점은 src/data/channel-prefs.json 에 저장한다.
// 저장 후 git commit/push 는 사용자가 직접 한다.
import fs from 'node:fs';
import path from 'node:path';

// 순수 함수: 선택을 반영한 새 media/prefs
export function applyPick(media, prefs, recipeId, videoId) {
  const entry = media[recipeId];
  if (!entry) throw new Error('알 수 없는 레시피');
  const nextPrefs = { ...prefs };
  const channelOf = (vid) => (entry.candidates || []).find((c) => c.videoId === vid)?.channelId;
  if (videoId && !channelOf(videoId)) throw new Error('후보에 없는 영상');
  const before = entry.picked ? channelOf(entry.picked) : null;
  if (before) nextPrefs[before] = Math.max(0, (nextPrefs[before] || 0) - 1);
  if (videoId) nextPrefs[channelOf(videoId)] = (nextPrefs[channelOf(videoId)] || 0) + 1;
  for (const k of Object.keys(nextPrefs)) if (!nextPrefs[k]) delete nextPrefs[k];
  return {
    media: {
      ...media,
      [recipeId]: { ...entry, picked: videoId || null, pickedAt: videoId ? new Date().toISOString() : null, pickedBy: null }
    },
    prefs: nextPrefs
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function curatePlugin({ root }) {
  const mediaPath = path.join(root, 'src', 'data', 'recipe-media.json');
  const prefsPath = path.join(root, 'src', 'data', 'channel-prefs.json');
  const recipesPath = path.join(root, 'src', 'data', 'recipes.seed.json');
  const htmlPath = path.join(root, 'scripts', 'curate', 'index.html');
  const read = (p, f) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return f;
    }
  };
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  return {
    name: 'agi-mamma-curate',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/__curate')) return next();
        // 이 PC에서만
        if (!LOOPBACK.has(req.socket.remoteAddress)) return send(res, 403, { error: 'local only' });
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'GET' && (url.pathname === '/__curate' || url.pathname === '/__curate/')) {
          return send(res, 200, fs.readFileSync(htmlPath, 'utf8'), 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && url.pathname === '/__curate/api/data') {
          const recipes = read(recipesPath, []).map((r) => ({ id: r.id, name: r.name }));
          return send(res, 200, { media: read(mediaPath, {}), prefs: read(prefsPath, {}), recipes });
        }
        if (req.method === 'POST' && url.pathname === '/__curate/api/pick') {
          // 다른 사이트에서 보낸 요청 막기: 전용 헤더 + 같은 출처
          const origin = req.headers.origin;
          if (
            req.headers['x-curate'] !== '1' ||
            (origin && new URL(origin).hostname !== 'localhost' && new URL(origin).hostname !== '127.0.0.1')
          ) {
            return send(res, 403, { error: 'forbidden' });
          }
          let raw = '';
          req.on('data', (c) => {
            raw += c;
            if (raw.length > 10000) req.destroy();
          });
          req.on('end', () => {
            try {
              const { recipeId, videoId } = JSON.parse(raw || '{}');
              const out = applyPick(read(mediaPath, {}), read(prefsPath, {}), String(recipeId), videoId ? String(videoId) : null);
              fs.writeFileSync(mediaPath, JSON.stringify(out.media, null, 2) + '\n');
              fs.writeFileSync(prefsPath, JSON.stringify(out.prefs, null, 2) + '\n');
              send(res, 200, { ok: true, picked: out.media[recipeId].picked, prefs: out.prefs });
            } catch (e) {
              send(res, 400, { error: e.message });
            }
          });
          return undefined;
        }
        return send(res, 404, { error: 'not found' });
      });
    }
  };
}
