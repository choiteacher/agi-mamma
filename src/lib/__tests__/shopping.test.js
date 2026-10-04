import { describe, expect, it } from 'vitest';

import menu from '../../data/menu-sets.seed.json';
import recipes from '../../data/recipes.seed.json';
import { buildShoppingList } from '../shopping';

const setsById = new Map(menu.sets.map((s) => [s.id, s]));
const recipesById = new Map(recipes.map((r) => [r.id, r]));

describe('장보기 목록', () => {
  const withSoup = menu.sets.find((s) => s.dishes.some((d) => d.recipe_id === 'seaweed-soup'));
  const list = buildShoppingList([{ date: '2026-10-05', setId: withSoup.id }], setsById, recipesById);

  it('세트의 레시피 재료를 사야 할 것과 집에 있는지 확인할 것으로 나눈다', () => {
    const buyNames = list.buy.map((i) => i.name);
    expect(buyNames).toContain('마른 미역');
    expect(list.pantry.map((i) => i.name)).toContain('국간장');
    expect(buyNames).not.toContain('국간장');
  });

  it('양은 요리별로 함께 보여 준다', () => {
    const miyeok = list.buy.find((i) => i.name === '마른 미역');
    expect(miyeok.uses[0]).toMatchObject({ amount: '20g', dish: '미역국', date: '2026-10-05' });
  });

  it('밥은 냉동 밥 확인으로, 쉬는 날·미룬 날은 빼고 모은다', () => {
    const rest = buildShoppingList([{ date: '2026-10-05', setId: null, status: 'rest' }], setsById, recipesById);
    expect(rest.buy).toEqual([]);
    const all = buildShoppingList(
      menu.sets.slice(0, 3).map((s, i) => ({ date: `2026-10-0${i + 5}`, setId: s.id })),
      setsById,
      recipesById
    );
    expect(all.pantry.some((i) => i.name.startsWith('밥'))).toBe(true);
  });
});
