import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import InstallWall from './components/InstallWall'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <InstallWall>
        <App />
      </InstallWall>
    </BrowserRouter>
  </React.StrictMode>,
)
