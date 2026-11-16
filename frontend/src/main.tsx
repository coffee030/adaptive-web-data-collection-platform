import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './app/App';
import './styles/console.css';
import './app/shell.css';
import './features/dashboard/dashboard.css';
import './features/sources/sources.css';
import './features/profiles/profiles.css';
import './features/results/results.css';
import './features/collection-jobs/jobs.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
