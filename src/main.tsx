import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/900.css';
import '@fontsource/rubik/900-italic.css';
import './index.css';
import App from './App';
import { initTelegram } from './platform/telegram';

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
