// 장보기 목록: 다가오는 요리 세션의 레시피 재료를 모은다(성인 약 5인분 기준 양).
// 단위가 제각각이라 양은 더하지 않고 요리별로 나란히 보여 준다.

// 집에 늘 있는 양념/기본 재료 (따로 묶어 "있는지 확인"으로 표시)
const PANTRY =
  /^(간장|국간장|소금|참기름|들기름|다진 마늘|설탕|흑설탕|올리고당|깨|후추|식용유|콩기름|맛술|된장|미소된장|굴소스|식초|밀가루|감자전분|버터|마요네즈|물|카레가루|새우젓|생강|배 간 것|우유)/;
const STOCK_BROTH = /육수/;

const normalize = (item) =>
  item
    .replace(/\(.*?\)/g, '')
    .replace(/\s*(또는|or)\s.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

export function buildShoppingList(sessions, setsById, recipesById) {
  const items = new Map(); // key → { name, pantry, uses: [{ amount, dish, date }] }
  const add = (name, pantry, use) => {
    const key = `${pantry ? 'p' : 'm'}|${name}`;
    if (!items.has(key)) items.set(key, { key, name, pantry, uses: [] });
    items.get(key).uses.push(use);
  };
  for (const s of sessions) {
    const set = s.setId && setsById.get(s.setId);
    if (!set) continue;
    for (const d of set.dishes) {
      if (d.role === 'base') {
        if (/밥$/.test(d.name)) add('밥 (냉동 밥 남았는지 확인)', true, { amount: '', dish: d.name, date: s.date });
        else add(d.name, false, { amount: '아이 몫 조금', dish: '곁들임', date: s.date });
        continue;
      }
      const recipe = d.recipe_id && recipesById.get(d.recipe_id);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        const name = normalize(ing.item);
        if (STOCK_BROTH.test(name)) {
          add('국물용 멸치·다시마 (육수용)', true, { amount: ing.amount, dish: recipe.name, date: s.date });
          continue;
        }
        add(name, PANTRY.test(name), { amount: ing.amount, dish: recipe.name, date: s.date });
      }
    }
  }
  const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { buy: list.filter((i) => !i.pantry), pantry: list.filter((i) => i.pantry) };
}
