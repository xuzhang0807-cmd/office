import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { SessionProvider } from './lib/session.jsx';
import { ToastProvider } from './lib/toast.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </React.StrictMode>,
);
