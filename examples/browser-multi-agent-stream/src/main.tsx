import { Theme } from '@radix-ui/themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@radix-ui/themes/styles.css'
import './style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 2000 },
  },
})

type ThemeAppearance = 'dark' | 'light'

const THEME_STORAGE_KEY = 'strands-playground-theme'

function getInitialTheme(): ThemeAppearance {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function Root(): JSX.Element {
  const [appearance, setAppearance] = React.useState<ThemeAppearance>(() => getInitialTheme())

  React.useEffect(() => {
    document.body.setAttribute('data-theme', appearance)
    window.localStorage.setItem(THEME_STORAGE_KEY, appearance)
  }, [appearance])

  return (
    <Theme appearance={appearance}>
      <QueryClientProvider client={queryClient}>
        <App
          themeAppearance={appearance}
          onToggleTheme={() => setAppearance((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        />
      </QueryClientProvider>
    </Theme>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
