import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// project import
import menu from '../data/menu-sets.seed.json';
import recipes from '../data/recipes.seed.json';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { buildPlan } from '../lib/planner';
import { todayYmd } from '../lib/dates';
import { createLocalStorageAdapter, newId, nowIso } from '../lib/storage';
import { buildExport, mergeData } from '../lib/sync';

// ==============================|| APP DATA ||============================== //
// 사용자 데이터(설정, 요리 기록, 재고)는 storage adapter를 통해서만 읽고 쓴다.
// 기록과 재고는 지우지 않고 deleted 표시를 남긴다(나중에 공유 코드 병합 시 updated_at 비교에 필요).

const AppDataContext = createContext(null);
const adapter = createLocalStorageAdapter();

export const SETS = menu.sets;
export const RECIPES = recipes;
export const setsById = new Map(SETS.map((s) => [s.id, s]));
export const recipesById = new Map(RECIPES.map((r) => [r.id, r]));

export const cookableDishes = (set) => set.dishes.filter((d) => d.role === 'dish');
export const setTitle = (set) =>
  set
    ? cookableDishes(set)
        .map((d) => d.name)
        .join(' · ')
    : '';

export function AppDataProvider({ children }) {
  // 저장하는 설정은 사용자가 바꾼 값(+updated_at)만. 기본값이 바뀌면 바꾸지 않은 항목은 새 기본값을 따른다.
  const [userSettings, setUserSettings] = useState(() => adapter.load('settings', {}));
  const settings = useMemo(() => ({ ...DEFAULT_SETTINGS, ...userSettings }), [userSettings]);
  const [meta, setMeta] = useState(() => adapter.load('meta', {}));
  const [cookLog, setCookLog] = useState(() => adapter.load('cookLog', []));
  const [stock, setStock] = useState(() => adapter.load('stock', []));
  const [today, setToday] = useState(() => todayYmd());

  useEffect(() => void adapter.save('settings', userSettings), [userSettings]);
  useEffect(() => void adapter.save('meta', meta), [meta]);
  useEffect(() => void adapter.save('cookLog', cookLog), [cookLog]);
  useEffect(() => void adapter.save('stock', stock), [stock]);

  // 앱을 켜 둔 채 날짜가 바뀌면 다시 계산
  useEffect(() => {
    const onFocus = () => setToday(todayYmd());
    window.addEventListener('focus', onFocus);
    const timer = setInterval(onFocus, 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, []);

  const activeLog = useMemo(() => cookLog.filter((e) => !e.deleted), [cookLog]);
  const activeStock = useMemo(() => stock.filter((s) => !s.deleted), [stock]);

  const plan = useMemo(
    () => buildPlan({ sets: SETS, recipes: RECIPES, settings, cookLog: activeLog, stock: activeStock, today }),
    [settings, activeLog, activeStock, today]
  );

  // 같은 날짜 기록이 둘 이상이면(두 기기에서 따로 기록 후 병합) 가장 최근에 고친 것을 쓴다
  const latestOn = (list, date) =>
    list.filter((e) => e.date === date && !e.deleted).sort((a, b) => ((a.updated_at || '') < (b.updated_at || '') ? 1 : -1))[0];
  const logFor = useCallback((date) => latestOn(activeLog, date), [activeLog]);

  const upsertLog = useCallback((date, patch) => {
    setCookLog((list) => {
      const cur = latestOn(list, date);
      const idx = cur ? list.indexOf(cur) : -1;
      if (idx < 0) return [...list, { id: newId(), date, checked: [], ...patch, updated_at: nowIso() }];
      const next = [...list];
      next[idx] = { ...next[idx], ...patch, updated_at: nowIso() };
      return next;
    });
  }, []);

  const toggleDish = useCallback(
    (date, setId, recipeId) => {
      const log = latestOn(activeLog, date);
      const checked = new Set(log ? log.checked || [] : []);
      if (checked.has(recipeId)) checked.delete(recipeId);
      else checked.add(recipeId);
      upsertLog(date, { setId, status: log && log.status === 'done' ? 'done' : 'cooking', checked: [...checked] });
    },
    [activeLog, upsertLog]
  );

  // 요리 완료: 냉장/냉동 몫을 재고로 등록
  const completeSession = useCallback(
    (date, setId, { fridge, freezer }) => {
      const log = latestOn(activeLog, date);
      const logId = log ? log.id : newId();
      const set = setsById.get(setId);
      const all = cookableDishes(set).map((d) => d.recipe_id);
      setCookLog((list) => {
        const rest = list.filter((e) => e.id !== logId);
        return [...rest, { ...(log || { id: logId, date }), setId, status: 'done', checked: all, fridge, freezer, updated_at: nowIso() }];
      });
      const lots = [
        ['fridge', fridge],
        ['freezer', freezer]
      ]
        .filter(([, n]) => n > 0)
        .map(([location, portions]) => ({ id: newId(), logId, setId, location, portions, date, asOf: date, updated_at: nowIso() }));
      setStock((list) => [...list, ...lots]);
    },
    [activeLog]
  );

  // 완료 취소: 재고에서 빼고 다시 "요리 중"으로
  const uncompleteSession = useCallback(
    (date) => {
      const log = latestOn(activeLog, date);
      if (!log) return;
      setStock((list) => list.map((s) => (s.logId === log.id && !s.deleted ? { ...s, deleted: true, updated_at: nowIso() } : s)));
      upsertLog(date, { status: 'cooking' });
    },
    [activeLog, upsertLog]
  );

  const skipSession = useCallback((date) => upsertLog(date, { status: 'skipped', setId: null, checked: [] }), [upsertLog]);

  const clearLog = useCallback((date) => {
    setCookLog((list) => list.map((e) => (e.date === date && !e.deleted ? { ...e, deleted: true, updated_at: nowIso() } : e)));
  }, []);

  const updateStockPortions = useCallback(
    (id, portions) => {
      setStock((list) => list.map((s) => (s.id === id ? { ...s, portions: Math.max(0, portions), asOf: today, updated_at: nowIso() } : s)));
    },
    [today]
  );

  const deleteStock = useCallback((id) => {
    setStock((list) => list.map((s) => (s.id === id ? { ...s, deleted: true, updated_at: nowIso() } : s)));
  }, []);

  const updateSettings = useCallback((patch) => setUserSettings((cur) => ({ ...cur, ...patch, updated_at: nowIso() })), []);
  const resetSettings = useCallback(() => setUserSettings({ updated_at: nowIso() }), []);

  // 즐겨찾기 세트는 favoriteReuseDays 뒤에 다시 만들 수 있다
  const toggleFavorite = useCallback(
    (setId) => {
      const cur = settings.favorites || [];
      updateSettings({ favorites: cur.includes(setId) ? cur.filter((id) => id !== setId) : [...cur, setId] });
    },
    [settings.favorites, updateSettings]
  );

  // 공유/백업: 내보낼 데이터, 가져온 데이터 병합 미리보기와 적용
  const exportData = useCallback(() => buildExport({ settings: userSettings, cookLog, stock }), [userSettings, cookLog, stock]);
  const previewImport = useCallback(
    (incoming) => mergeData({ settings: userSettings, cookLog, stock }, incoming),
    [userSettings, cookLog, stock]
  );
  const applyMerged = useCallback((merged) => {
    setUserSettings(merged.settings || {});
    setCookLog(merged.cookLog);
    setStock(merged.stock);
  }, []);
  const markBackup = useCallback(() => setMeta((m) => ({ ...m, lastBackupAt: nowIso() })), []);
  const hasData = cookLog.length > 0 || stock.length > 0;

  const value = {
    today,
    settings,
    updateSettings,
    resetSettings,
    toggleFavorite,
    exportData,
    previewImport,
    applyMerged,
    markBackup,
    meta,
    hasData,
    plan,
    stock: activeStock,
    logFor,
    toggleDish,
    completeSession,
    uncompleteSession,
    skipSession,
    clearLog,
    updateStockPortions,
    deleteStock
  };
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export const useAppData = () => useContext(AppDataContext);
