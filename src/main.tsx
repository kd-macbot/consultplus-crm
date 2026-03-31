import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { seedData } from './lib/seed'
import './styles/globals.css'

// Seed data on first load
seedData()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
