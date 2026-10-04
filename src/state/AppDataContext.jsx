import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// project import
import menu from '../data/menu-sets.seed.json';
import recipes from '../data/recipes.seed.json';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { buildPlan } from '../lib/planner';
import { todayYmd } from '../lib/dates';
import { createLocalStorageAdapter, newId, nowIso } from '../lib/storage';
import { buildExport, mergeData } from '../lib/sync';
import { latestRatings } from '../lib/videoChoice';
import baseRatings from '../data/video-ratings.json';

// ==============================|| APP DATA ||============================== //
// 사용자 데이터(설정, 요리 기록)는 storage adapter를 통해서만 읽고 쓴다.
// 기록은 지우지 않고 deleted 표시를 남긴다(나중에 공유 코드 병합 시 updated_at 비교에 필요).
// 재고(stock)는 화면에서 뺐다(냉장·냉동은 사용자가 직접 관리). 이전 버전 데이터는 공유 코드·백업 호환을 위해 그대로 둔다.

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
  const [videoRatings, setVideoRatings] = useState(() => adapter.load('videoRatings', []));
  const [today, setToday] = useState(() => todayYmd());

  useEffect(() => void adapter.save('settings', userSettings), [userSettings]);
  useEffect(() => void adapter.save('meta', meta), [meta]);
  useEffect(() => void adapter.save('cookLog', cookLog), [cookLog]);
  useEffect(() => void adapter.save('stock', stock), [stock]);
  useEffect(() => void adapter.save('videoRatings', videoRatings), [videoRatings]);

  // 영상 평가: 저장소에 모인 평가(video-ratings.json) + 이 기기 평가, 같은 영상은 더 최근 것
  const ratingMap = useMemo(() => latestRatings(baseRatings, videoRatings), [videoRatings]);
  const rateVideo = useCallback(({ videoId, recipeId, channelId, rating }) => {
    setVideoRatings((list) => [
      ...list.filter((r) => r.id !== videoId),
      { id: videoId, recipeId, channelId, rating, updated_at: nowIso() }
    ]);
  }, []);

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

  const plan = useMemo(
    () => buildPlan({ sets: SETS, recipes: RECIPES, settings, cookLog: activeLog, today }),
    [settings, activeLog, today]
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

  // 요리 완료. 끼니표는 완료한 세트를 "제안대로 냉장·냉동했다"고 보고 계산한다.
  const completeSession = useCallback(
    (date, setId) => {
      const set = setsById.get(setId);
      upsertLog(date, { setId, status: 'done', checked: cookableDishes(set).map((d) => d.recipe_id) });
    },
    [upsertLog]
  );

  // 완료 취소: 다시 "요리 중"으로
  const uncompleteSession = useCallback((date) => upsertLog(date, { status: 'cooking' }), [upsertLog]);

  const skipSession = useCallback((date) => upsertLog(date, { status: 'skipped', setId: null, checked: [] }), [upsertLog]);

  const clearLog = useCallback((date) => {
    setCookLog((list) => list.map((e) => (e.date === date && !e.deleted ? { ...e, deleted: true, updated_at: nowIso() } : e)));
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
  const exportData = useCallback(
    () => buildExport({ settings: userSettings, cookLog, stock, videoRatings }),
    [userSettings, cookLog, stock, videoRatings]
  );
  const previewImport = useCallback(
    (incoming) => mergeData({ settings: userSettings, cookLog, stock, videoRatings }, incoming),
    [userSettings, cookLog, stock, videoRatings]
  );
  const applyMerged = useCallback((merged) => {
    setUserSettings(merged.settings || {});
    setCookLog(merged.cookLog);
    setStock(merged.stock);
    setVideoRatings(merged.videoRatings || []);
  }, []);
  const markBackup = useCallback(() => setMeta((m) => ({ ...m, lastBackupAt: nowIso() })), []);
  const hasData = cookLog.length > 0 || stock.length > 0 || videoRatings.length > 0;

  const value = {
    today,
    settings,
    updateSettings,
    resetSettings,
    toggleFavorite,
    ratingMap,
    rateVideo,
    exportData,
    previewImport,
    applyMerged,
    markBackup,
    meta,
    hasData,
    plan,
    logFor,
    toggleDish,
    completeSession,
    uncompleteSession,
    skipSession,
    clearLog
  };
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export const useAppData = () => useContext(AppDataContext);
