// 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다(시간대 영향을 받지 않도록 UTC 기준 계산).

const DAY_MS = 86400000;
export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const toUtc = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (ymd, n) => fromUtc(toUtc(ymd) + n * DAY_MS);
export const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
export const weekday = (ymd) => new Date(toUtc(ymd)).getUTCDay();
export const monthOf = (ymd) => Number(ymd.slice(5, 7));
export const isWeekend = (ymd) => [0, 6].includes(weekday(ymd));

export const todayYmd = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export const firstOfMonth = (ymd) => `${ymd.slice(0, 7)}-01`;

export const lastOfNextMonth = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  // m(1~12)의 다음 달 마지막 날 = m+2 달의 0일
  return fromUtc(Date.UTC(y, m + 1, 0));
};

export const rangeDays = (start, end) => {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};

// 월요일 시작 주의 월요일
export const weekStart = (ymd) => addDays(ymd, -((weekday(ymd) + 6) % 7));

export const formatKo = (ymd) => `${monthOf(ymd)}/${Number(ymd.slice(8))}(${WEEKDAY_KO[weekday(ymd)]})`;
