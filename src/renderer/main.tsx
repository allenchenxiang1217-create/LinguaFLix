import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { initMediaUrl } from './services/stream-resolver'

// Initialize the media server URL early so toMediaUrl works immediately
initMediaUrl()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
