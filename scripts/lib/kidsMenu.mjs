// 어린이급식관리지원센터 엑셀(영양성분표/표준레시피)에서 (날짜, 끼니, 요리명)만 뽑는다.
// 재료량, 조리법 문장, 영양 수치는 읽지도 저장하지도 않는다.
import ExcelJS from 'exceljs';

import { cleanDishName } from './dishRules.mjs';

const DATE_CELL = /^(\d{1,2})\s*\[[월화수목금토일]\]$/;
const SLOT_CELL = /^(아침|조식|오전간식|점심|중식|오후간식|간식|저녁|석식)$/;
// 같은 식단의 다른 버전이라 중복 집계되는 시트
const SKIP_SHEET = /죽형|생일|생선배제|이유식/;

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if (v.text) return String(v.text);
    return '';
  }
  return String(v);
};

// 원문자 알레르기 표기(①~⑳)와 지역 표기 "(경남)" 등을 지운다.
export const cleanMenuName = (raw) => cleanDishName(raw.replace(/[①-⑳㉑-㉟]/g, ' '));

// 파일 머리말의 "2025년10월" / "10월 식단" 표기에서 월을 읽는다(파일과 달이 맞는지 확인용).
const MONTH_HEADER = /(?:(20\d\d)년\s*)?(\d{1,2})월\s*(?:일반형\s*)?식단/;

export async function readMenuEntries(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const entries = [];
  let headerMonth = null;
  const seen = new Set();
  for (const ws of wb.worksheets) {
    if (SKIP_SHEET.test(ws.name)) continue;
    ws.eachRow((row) => {
      const cells = row.values.slice(1).map((v) => cellText(v).replace(/\s+/g, ' ').trim());
      if (headerMonth == null) {
        const hit = cells.map((c) => c.match(MONTH_HEADER)).find(Boolean);
        if (hit) headerMonth = Number(hit[2]);
      }
      const dateIdx = cells.findIndex((c) => DATE_CELL.test(c));
      const slotIdx = cells.findIndex((c, i) => i > dateIdx && SLOT_CELL.test(c));
      if (dateIdx < 0 || slotIdx < 0) return;
      const nameRaw = cells.slice(slotIdx + 1).find((c) => c && !/^[\d.]+$/.test(c));
      if (!nameRaw) return;
      const name = cleanMenuName(nameRaw);
      if (name.length < 2) return;
      const day = Number(cells[dateIdx].match(DATE_CELL)[1]);
      const slot = cells[slotIdx].replace('중식', '점심').replace('석식', '저녁').replace('조식', '아침');
      const key = `${day}|${slot}|${name}`;
      if (seen.has(key)) return; // 레시피 표는 재료마다 행이 반복된다
      seen.add(key);
      entries.push({ day, slot, name, sheet: ws.name });
    });
  }
  entries.headerMonth = headerMonth;
  return entries;
}
