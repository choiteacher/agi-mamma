import { forgetUnlock } from './storage';

// "잠그기": 기억을 지우고 새로고침해서 앱을 메모리에서 완전히 내린다.
export function lockNow() {
  forgetUnlock();
  window.location.reload();
}
