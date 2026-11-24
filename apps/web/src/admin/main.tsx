import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/index.css';
import { AdminApp } from './AdminApp';

ReactDOM.createRoot(document.getElementById('admin-root')!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
