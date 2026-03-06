'use client'
import { useStore } from '@/lib/store'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ContextMenuProvider } from '@/components/ui/ContextMenu'
import SplashScreen from '@/components/ide/SplashScreen'
import OnboardingModal from '@/components/ide/OnboardingModal'

const WelcomeScreen  = dynamic(() => import('@/components/ide/WelcomeScreen'),  { ssr: false })
const IdeScreen      = dynamic(() => import('@/components/ide/IdeScreen'),      { ssr: false })
const SettingsScreen = dynamic(() => import('@/components/ide/SettingsScreen'), { ssr: false })
const DocsScreen     = dynamic(() => import('@/components/docs/DocsScreen'),     { ssr: false })

export default function Page() {
  const screen = useStore(s => s.screen)

  // Splash: shown on startup, dismissed once app is ready
  const [splashReady, setSplashReady] = useState(false)
  const [showSplash,  setShowSplash]  = useState(true)
  const [showOnboard, setShowOnboard] = useState(false)

  // Load persisted settings
  useEffect(() => {
    import('@/lib/tauri').then(async ({ loadSettings }) => {
      try {
        const raw = await loadSettings()
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          useStore.setState(s => ({ settings: { ...s.settings, ...saved } }))
        }
      } catch { /* ignore parse errors — use defaults */ }
    })
  }, [])

  // After a short settle time, mark the app as ready → fills the progress bar
  useEffect(() => {
    const t = setTimeout(() => setSplashReady(true), 900)
    return () => clearTimeout(t)
  }, [])

  function handleSplashDone() {
    setShowSplash(false)
    try {
      if (!localStorage.getItem('tsuki-onboarding-done')) {
        setShowOnboard(true)
      }
    } catch { /* private browsing */ }
  }

  function handleOnboardingClose() {
    setShowOnboard(false)
    try { localStorage.setItem('tsuki-onboarding-done', '1') } catch {}
  }

  return (
    <main className="h-screen overflow-hidden">
      {/* Splash screen — rendered on top until dismissed */}
      {showSplash && (
        <SplashScreen ready={splashReady} onDone={handleSplashDone} />
      )}

      {/* App screens — rendered beneath splash so they're ready when it fades */}
      {screen === 'welcome'  && <WelcomeScreen />}
      {screen === 'ide'      && <IdeScreen />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'docs'     && <DocsScreen />}

      <ContextMenuProvider />

      {/* First-run onboarding modal */}
      {showOnboard && !showSplash && (
        <OnboardingModal onClose={handleOnboardingClose} />
      )}
    </main>
  )
}