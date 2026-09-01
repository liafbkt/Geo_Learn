import React from 'react';
import ReactDOM from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { App } from './app/App';
import { createBrowserDependencies, createTauriDependencies } from './app/dependencies';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('应用根节点不可用。');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App dependencies={isTauri() ? createTauriDependencies() : createBrowserDependencies()} />
  </React.StrictMode>,
);
