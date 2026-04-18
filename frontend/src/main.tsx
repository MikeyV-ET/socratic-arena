import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useArenaStore } from '@/stores/arenaStore'

// Expose store for e2e testing (Selenium can call window.__ARENA_STORE__)
if (import.meta.env.DEV) {
  (window as never)['__ARENA_STORE__'] = useArenaStore;
}

// Apply saved theme on load
const savedTheme = localStorage.getItem("arena-theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
