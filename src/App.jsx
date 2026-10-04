import React from 'react';
import { HashRouter } from 'react-router-dom';

// project-import
import renderRoutes, { routes } from './routes';

// ==============================|| APP ||============================== //

// GitHub Pages는 서버 라우팅이 없으므로 HashRouter(#/경로)를 쓴다.
const App = () => {
  return <HashRouter>{renderRoutes(routes)}</HashRouter>;
};

export default App;
