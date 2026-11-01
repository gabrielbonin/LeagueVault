import '@fontsource/cinzel/500.css'
import '@fontsource/cinzel/700.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

createRoot(document.getElementById('root')!).render(<App />)
