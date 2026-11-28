import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/i18n';
import '@/styles/index.css';
import { LabApp } from './LabApp';

ReactDOM.createRoot(document.getElementById('lab-root')!).render(
  <React.StrictMode>
    <LabApp />
  </React.StrictMode>,
);
