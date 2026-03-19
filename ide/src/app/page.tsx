'use client'
import { useStore } from '@/lib/store'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { ContextMenuProvider } from '@/components/shared/ContextMenu'
import SplashScreen from '@/components/screens/SplashScreen'
import OnboardingModal from '@/components/other/OnboardingModal'
import WhatsNewModal from '@/components/other/WhatsNewModal'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import type { ChangelogEntry } from '@/components/other/WhatsNewModal'

const WelcomeScreen  = dynamic(() => import('@/components/screens/WelcomeScreen'),  { ssr: false })
const IdeScreen      = dynamic(() => import('@/components/screens/IdeScreen'),      { ssr: false })
const SettingsScreen = dynamic(() => import('@/components/screens/SettingsScreen'), { ssr: false })
const DocsScreen     = dynamic(() => import('@/components/docs/DocsScreen'),     { ssr: false })

// ─────────────────────────────────────────────────────────────────────────────
//  LocalStorage keys
// ─────────────────────────────────────────────────────────────────────────────

const LS_ONBOARDING_DONE    = 'tsuki-onboarding-done'
const LS_ONBOARDING_VERSION = 'tsuki-onboarding-version'
const LS_WHATS_NEW_SEEN     = 'tsuki-whats-new-seen'

// ─────────────────────────────────────────────────────────────────────────────
//  Semver helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const [ma, mi, pa] = (v ?? '0.0.0').replace(/^v/, '').split('.').map(Number)
  return [ma || 0, mi || 0, pa || 0]
}

/** Returns true if b is strictly greater than a */
function semverGt(a: string, b: string): boolean {
  const [aMa, aMi, aPa] = parseSemver(a)
  const [bMa, bMi, bPa] = parseSemver(b)
  if (bMa !== aMa) return bMa > aMa
  if (bMi !== aMi) return bMi > aMi
  return bPa > aPa
}

/** Returns true if the major version differs (considered a "big" update) */
function isMajorBump(a: string, b: string): boolean {
  return parseSemver(a)[0] !== parseSemver(b)[0]
}

// ─────────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Page() {
  const screen   = useStore(s => s.screen)
  const settings = useStore(s => s.settings)

  const [splashReady, setSplashReady] = useState(false)
  const [showSplash,  setShowSplash]  = useState(true)

  // Onboarding
  const [showOnboard,      setShowOnboard]      = useState(false)
  const [onboardMode,      setOnboardMode]      = useState<'first-run'|'update'>('first-run')
  const [onboardVersion,   setOnboardVersion]   = useState<string|undefined>(undefined)

  // What's New
  const [showWhatsNew,     setShowWhatsNew]     = useState(false)
  const [whatsNewVersion,  setWhatsNewVersion]  = useState('')
  const [whatsNewEntries,  setWhatsNewEntries]  = useState<ChangelogEntry[]>([])

  // Load persisted settings
  useEffect(() => {
    import('@/lib/tauri').then(async ({ loadSettings, installDebugLogger }) => {
      try {
        const raw  = await loadSettings()
        const saved = JSON.parse(raw)
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          useStore.setState(s => ({ settings: { ...s.settings, ...saved } }))
          if (saved.debugMode === true) installDebugLogger()
        }
      } catch { /* ignore — use defaults */ }
    })
  }, [])

  // Splash countdown
  useEffect(() => {
    const t = setTimeout(() => setSplashReady(true), 900)
    return () => clearTimeout(t)
  }, [])

  // ── Called once the splash finishes ──
  function handleSplashDone() {
    setShowSplash(false)
    try {
      const lsOnboard = localStorage.getItem(LS_ONBOARDING_DONE)
      const lsVersion = localStorage.getItem(LS_ONBOARDING_VERSION) ?? '0.0.0'
      const lsWhatsNew = localStorage.getItem(LS_WHATS_NEW_SEEN) ?? '0.0.0'

      // 1. First-run: never completed onboarding
      if (!lsOnboard) {
        setOnboardMode('first-run')
        setShowOnboard(true)
        return
      }

      // 2. Update forced a re-show of the onboarding wizard
      const forcedV = settings.forcedOnboardingVersion
      if (forcedV && semverGt(lsVersion, forcedV)) {
        setOnboardMode('update')
        setOnboardVersion(forcedV)
        setShowOnboard(true)
        // Don't check What's New yet — we'll do it after onboarding closes
        return
      }

      // 3. Big update → What's New popup
      checkWhatsNew(lsWhatsNew)
    } catch { /* private browsing */ }
  }

  function checkWhatsNew(lastSeenWhatsNew: string) {
    try {
      const wnVersion  = settings.whatsNewVersion
      const wnChangelog = settings.whatsNewChangelog
      if (
        wnVersion &&
        wnChangelog &&
        semverGt(lastSeenWhatsNew, wnVersion)
      ) {
        try {
          const parsed: ChangelogEntry[] = JSON.parse(wnChangelog)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setWhatsNewVersion(wnVersion)
            setWhatsNewEntries(parsed)
            setShowWhatsNew(true)
          }
        } catch { /* malformed changelog JSON */ }
      }
    } catch { /* ignore */ }
  }

  function handleOnboardingClose() {
    setShowOnboard(false)
    try {
      localStorage.setItem(LS_ONBOARDING_DONE, '1')
      // Record the version we just ran the wizard for
      const v = onboardVersion ?? settings.whatsNewVersion ?? '0.0.0'
      localStorage.setItem(LS_ONBOARDING_VERSION, v)
    } catch {}
    // After forced-update onboarding, check if we should also show What's New
    if (onboardMode === 'update') {
      const lsWhatsNew = (() => { try { return localStorage.getItem(LS_WHATS_NEW_SEEN) ?? '0.0.0' } catch { return '0.0.0' } })()
      checkWhatsNew(lsWhatsNew)
    }
  }

  function handleWhatsNewClose() {
    setShowWhatsNew(false)
    try {
      localStorage.setItem(LS_WHATS_NEW_SEEN, whatsNewVersion)
    } catch {}
  }

  return (
    <main className="h-screen overflow-hidden">
      {showSplash && (
        <SplashScreen ready={splashReady} onDone={handleSplashDone} />
      )}

      <ErrorBoundary name="WelcomeScreen">
        {screen === 'welcome'  && <WelcomeScreen />}
      </ErrorBoundary>
      <ErrorBoundary name="IdeScreen">
        {screen === 'ide'      && <IdeScreen />}
      </ErrorBoundary>
      <ErrorBoundary name="SettingsScreen">
        {screen === 'settings' && <SettingsScreen />}
      </ErrorBoundary>
      <ErrorBoundary name="DocsScreen">
        {screen === 'docs'     && <DocsScreen />}
      </ErrorBoundary>

      <ContextMenuProvider />

      {/* Onboarding wizard */}
      {showOnboard && !showSplash && (
        <OnboardingModal
          onClose={handleOnboardingClose}
          mode={onboardMode}
          forcedVersion={onboardVersion}
        />
      )}

      {/* What's New popup — shown after onboarding if needed, or directly on launch */}
      {showWhatsNew && !showSplash && !showOnboard && (
        <WhatsNewModal
          version={whatsNewVersion}
          entries={whatsNewEntries}
          onClose={handleWhatsNewClose}
        />
      )}
    </main>
  )
}