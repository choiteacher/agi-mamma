// 사이드바 메뉴. url은 HashRouter 경로(#/week 등)이고, routes.jsx와 같은 값을 쓴다.
const menuItems = {
  items: [
    {
      id: 'plan',
      title: '요리 일정',
      type: 'group',
      icon: 'icon-navigation',
      children: [
        { id: 'week', title: '이번 주 요리일정', type: 'item', icon: 'feather icon-check-square', url: '/week' },
        { id: 'calendar', title: '월간 캘린더', type: 'item', icon: 'feather icon-calendar', url: '/calendar' },
        { id: 'meals', title: '먹일 끼니표', type: 'item', icon: 'feather icon-grid', url: '/meals' }
      ]
    },
    {
      id: 'kitchen',
      title: '부엌',
      type: 'group',
      icon: 'icon-ui',
      children: [
        { id: 'stock', title: '재고(냉장·냉동)', type: 'item', icon: 'feather icon-package', url: '/stock' },
        { id: 'recipes', title: '레시피', type: 'item', icon: 'feather icon-book', url: '/recipes' },
        { id: 'shopping', title: '장보기 목록', type: 'item', icon: 'feather icon-shopping-cart', url: '/shopping' }
      ]
    },
    {
      id: 'manage',
      title: '관리',
      type: 'group',
      icon: 'icon-pages',
      children: [{ id: 'settings', title: '설정', type: 'item', icon: 'feather icon-settings', url: '/settings' }]
    }
  ]
};

export default menuItems;
