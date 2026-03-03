'use client'
import { useStore } from '@/lib/store'
import { useEffect } from 'react'
import dynamic from 'next/dynamic'

const WelcomeScreen  = dynamic(() => import('@/components/ide/WelcomeScreen'),  { ssr: false })
const IdeScreen      = dynamic(() => import('@/components/ide/IdeScreen'),      { ssr: false })
const SettingsScreen = dynamic(() => import('@/components/ide/SettingsScreen'), { ssr: false })

export default function Page() {
  const screen = useStore(s => s.screen)

  // Load persisted settings on first mount
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

  return (
    <main className="h-screen overflow-hidden">
      {screen === 'welcome'  && <WelcomeScreen />}
      {screen === 'ide'      && <IdeScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </main>
  )
}