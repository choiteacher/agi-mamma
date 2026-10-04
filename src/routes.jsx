import React, { Suspense, Fragment, lazy } from 'react';
import { Routes, Navigate, Route } from 'react-router-dom';

// project import
import Loader from './components/Loader/Loader';
import AdminLayout from './layouts/AdminLayout';

import { BASE_URL } from './config/constant';

// ==============================|| ROUTES ||============================== //

const renderRoutes = (routes = []) => (
  <Suspense fallback={<Loader />}>
    <Routes>
      {routes.map((route, i) => {
        const Guard = route.guard || Fragment;
        const Layout = route.layout || Fragment;
        const Element = route.element;

        return (
          <Route
            key={i}
            path={route.path}
            exact={route.exact}
            element={
              <Guard>
                <Layout>{route.routes ? renderRoutes(route.routes) : <Element props={true} />}</Layout>
              </Guard>
            }
          />
        );
      })}
    </Routes>
  </Suspense>
);

export const routes = [
  {
    path: '*',
    layout: AdminLayout,
    routes: [
      { exact: 'true', path: '/week', element: lazy(() => import('./views/WeekPlan')) },
      { exact: 'true', path: '/calendar', element: lazy(() => import('./views/MonthCalendar')) },
      { exact: 'true', path: '/meals', element: lazy(() => import('./views/MealTable')) },
      { exact: 'true', path: '/stock', element: lazy(() => import('./views/Stock')) },
      { exact: 'true', path: '/recipes', element: lazy(() => import('./views/Recipes')) },
      { exact: 'true', path: '/shopping', element: lazy(() => import('./views/Shopping')) },
      { exact: 'true', path: '/settings', element: lazy(() => import('./views/Settings')) },
      {
        path: '*',
        exact: 'true',
        element: () => <Navigate to={BASE_URL} replace />
      }
    ]
  }
];

export default renderRoutes;
