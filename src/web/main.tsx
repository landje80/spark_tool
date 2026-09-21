import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { BASE } from './api';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root ontbreekt');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={BASE}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
