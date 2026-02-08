import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { initializeONet } from './utils/onetClient'

// Initialize O*NET cache early for fast skills standardization
initializeONet().then(() => {
  console.log('✅ O*NET skills cache loaded');
}).catch(err => {
  console.warn('⚠️  O*NET cache failed to load, using client-side normalization:', err);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/internal-jobs-review">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
