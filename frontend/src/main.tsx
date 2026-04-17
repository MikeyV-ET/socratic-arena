import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply saved theme on load
const savedTheme = localStorage.getItem("arena-theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
