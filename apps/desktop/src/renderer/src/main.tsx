import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@pm/ui';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="pm-theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
