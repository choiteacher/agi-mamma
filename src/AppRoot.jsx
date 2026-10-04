import React from 'react';

// styles
import './index.scss';

// project import
import App from './App';
import { ConfigProvider } from './contexts/ConfigContext';
import { AppDataProvider } from './state/AppDataContext';
import { RecipeUiProvider } from './components/recipe/RecipeUi';

// ==============================|| APP ROOT ||============================== //

// 잠금 해제 후에만 lazy import 되는 실제 앱 (레이아웃, 라우트, 스타일, 식단 데이터 포함)
const AppRoot = () => (
  <ConfigProvider>
    <AppDataProvider>
      <RecipeUiProvider>
        <App />
      </RecipeUiProvider>
    </AppDataProvider>
  </ConfigProvider>
);

export default AppRoot;
