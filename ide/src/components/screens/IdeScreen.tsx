'use client'
import { useStore } from '@/lib/store'
import NewProjectModal from '@/components/other/NewProjectModal'
import { useState, useEffect, useRef } from 'react'
import { Btn, Divider } from '@/components/shared/primitives'
import FilesSidebar from '@/components/other/FilesSidebar'
import GitSidebar from '@/components/experiments/GitSidebar/GitSidebar'
import PackagesSidebar from '@/components/other/PackagesSidebar'
import ExamplesSidebar from '@/components/other/ExamplesSidebar'
// TEMP HIDDEN: import FileExplorer from '@/components/other/FileExplorer'
import CodeEditor from '@/components/other/CodeEditor'
import BottomPanel from '@/components/other/BottomPanel'
import SandboxPanel from '@/components/experiments/SandboxPanel/SandboxPanel'
import ExportWorkstation from '@/components/other/ExportWorkstation'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import {
  Files, GitBranch, Settings, X, ChevronRight, Package, Cpu, BookOpen,
  Code2, Share2, AlertTriangle, FolderOpen,
} from 'lucide-react'
import type { ElementType } from 'react'
import { clsx } from 'clsx'
import { showContextMenu } from '@/components/shared/ContextMenu'
import { useT } from '@/lib/i18n'
import { AppChrome } from '@/components/shared/AppChrome'

const BOARDS = [
  'uno','nano','nano_old','mega','leonardo','micro','pro_mini_5v','pro_mini_3v3',
  'esp32','esp32s2','esp32c3','esp8266','d1_mini','nodemcu',
  // TEMP HIDDEN: 'pico','xiao_rp2040',
]

const EXPERIMENTAL_BOARDS: Record<string, string> = {
  // TEMP HIDDEN: pico: 'El soporte para Raspberry Pi Pico (RP2040) es experimental. Requiere el core earlephilhower instalado en arduino-cli.',
}

// ── Workstation pages ─────────────────────────────────────────────────────────

type Workstation = 'code' | 'sandbox' | 'export'

const WORKSTATIONS: { id: Workstation; label: string; Icon: ElementType; shortcut: string }[] = [
  { id: 'code',    label: 'Code',    Icon: Code2,  shortcut: '1' },
  { id: 'sandbox', label: 'Sandbox', Icon: Cpu,    shortcut: '2' },
  { id: 'export',  label: 'Export',  Icon: Share2, shortcut: '3' },
]

export default function IdeScreen() {
  const {
    projectName, projectPath, projectLanguage, board, backend, setBoard, setScreen,
    sidebarOpen, sidebarTab, toggleSidebar,
    openTabs, activeTabIdx, closeTab, openFile,
    tree, toggleTheme, theme,
    settings, updateSetting, setBottomTab, saveActiveFile, dispatchCommand, dispatchBuild,
    pendingCircuit, clearPendingCircuit,
  } = useStore()

  const t = useT()
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)

  // Legacy sandbox panel (used when workstations are OFF)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [sandboxWidth, setSandboxWidth] = useState(480)
  const [resizingSandbox, setResizingSandbox] = useState(false)
  const [resizingSidebar, setResizingSidebar] = useState(false)

  // Workstation page (used when workstations experiment is ON)
  const [workstation, setWorkstation] = useState<Workstation>('code')

  // Workstations always enabled (no longer an experiment)
  const workstationsEnabled = true
  const sandboxEnabled      = settings.experimentsEnabled && settings.expSandboxEnabled
  useEffect(() => {
    if (!pendingCircuit) return
    clearPendingCircuit()
    if (workstationsEnabled) {
      setWorkstation('sandbox')
    } else if (sandboxEnabled) {
      setSandboxOpen(true)
    }
  }, [pendingCircuit?.id]) // eslint-disable-line

  const activeTab  = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null
  const activeNode = activeTab ? tree.find(n => n.id === activeTab.fileId) : null
  const parentNode = activeNode
    ? tree.find(p => p.type === 'dir' && p.children?.includes(activeNode.id) && p.id !== 'root')
    : null


  const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^\"|\"$/g, '')
  const cwd   = projectPath || undefined

  function makeArgs(verb: string, ...extra: string[]): string[] {
    const args = [verb, ...extra]
    if (board)            args.push('--board', board)
    if (settings.verbose) args.push('--verbose')
    return args
  }

  function dispatch(args: string[]) {
    // Build/check/compile → Output tab so it doesn't pollute the terminal
    dispatchBuild(tsuki, args, cwd)
  }

  function handleCheck()   { dispatch(makeArgs('check')) }
  function handleBuild()   { dispatch(makeArgs('build', '--compile')) }
  function handleFlash()   { dispatch(makeArgs('upload')) }
  function handleRun() {
    setBottomTab('terminal')
    dispatchCommand(tsuki, makeArgs('build', '--compile'), cwd, makeArgs('upload'))
  }
  function handleMonitor() {
    // Switch to the built-in serial monitor tab instead of spawning a CLI process
    setBottomTab('monitor')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'b' && !e.shiftKey) { e.preventDefault(); handleRun();     return }
      if (e.key === 'B' && e.shiftKey)  { e.preventDefault(); handleBuild();   return }
      if (e.key === 'T' && e.shiftKey)  { e.preventDefault(); handleCheck();   return }
      if (e.key === 'U' && e.shiftKey)  { e.preventDefault(); handleFlash();   return }
      if (e.key === 'm' && !e.shiftKey) { e.preventDefault(); handleMonitor(); return }
      // Workstation shortcuts: Ctrl+1/2/3 when workstations enabled
      if (workstationsEnabled) {
        if (e.key === '1') { setWorkstation('code');    return }
        if (e.key === '2') { setWorkstation('sandbox'); return }
        if (e.key === '3') { setWorkstation('export');  return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tsuki, board, cwd, settings.verbose, settings.defaultBaud, workstationsEnabled]) // eslint-disable-line

  useEffect(() => {
    const { addLog } = useStore.getState()
    const s = useStore.getState().settings

    // ── Project + environment ────────────────────────────────────────────────
    addLog('info', `IDE ready · project: ${projectName || '(none)'} · board: ${board} · lang: ${projectLanguage}`)

    // ── Experiments ──────────────────────────────────────────────────────────
    // Each flag on its own line so toggling one doesn't bury the others.
    addLog('info', [
      `Experiments: sandbox=${s.expSandboxEnabled}`,
      `git=${s.expGitEnabled}`,
      `lsp=${s.expLspEnabled}`,
      `workstations=${s.expWorkstationsEnabled}`,
      `enabled=${s.experimentsEnabled}`,
    ].join(' '))

    // ── Build / compiler settings ────────────────────────────────────────────
    addLog('info', [
      `Build: backend=${backend}`,
      `cpp_std=${s.cppStd}`,
      `baud=${s.defaultBaud}`,
      `verbose=${s.verbose}`,
    ].join(' · '))

    // ── Toolchain paths ──────────────────────────────────────────────────────
    // Logged separately so long paths don't truncate the other fields.
    const tsukiFlashResolved = s.tsukiFlashPath?.trim() || '(auto)'
    addLog('info', `Toolchain: tsuki-flash=${tsukiFlashResolved}`)

    // ── UI / layout ──────────────────────────────────────────────────────────
    addLog('info', [
      `UI: theme=${useStore.getState().theme}`,
      `adaptiveSidebar=${s.adaptiveSidebar}`,
      `minWindowWidth=${s.minWindowWidth ?? 1024}`,
    ].join(' · '))

    const currentPath = settings.tsukiPath?.trim()
    const isAbsolutePath = currentPath?.includes('\\') || currentPath?.includes('/')
    if (!isAbsolutePath) {
      addLog('info', 'Detecting tsuki binary in PATH…')
      import('@/lib/tauri').then(({ detectTool }) => {
        detectTool('tsuki')
          .then(resolved => {
            useStore.getState().updateSetting('tsukiPath', resolved)
            useStore.getState().addLog('ok', `tsuki found: ${resolved}`)
          })
          .catch(() => {
            useStore.getState().addLog('warn', 'tsuki not found in PATH. Go to Settings → CLI Tools → set full path.')
          })
      })
    } else {
      addLog('ok', `tsuki path configured: ${currentPath}`)
    }
  }, []) // eslint-disable-line

  // Sandbox resize (legacy mode)
  useEffect(() => {
    if (!resizingSandbox) return
    function onMove(e: MouseEvent) {
      setSandboxWidth(w => Math.max(320, Math.min(900, w + (document.body.clientWidth - e.clientX - w))))
    }
    function onUp() { setResizingSandbox(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizingSandbox])

  // Sidebar resize
  useEffect(() => {
    if (!resizingSidebar) return
    function onMove(e: MouseEvent) {
      const newW = Math.max(140, Math.min(480, e.clientX - 40))
      updateSetting('sidebarWidth', newW)
      updateSetting('ideLayout', 'custom')
    }
    function onUp() { setResizingSidebar(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizingSidebar]) // eslint-disable-line



  // Adaptive sidebar: auto-collapse when window narrower than threshold
  useEffect(() => {
    if (!settings.adaptiveSidebar) return
    const threshold = settings.minWindowWidth ?? 1024
    function check() {
      if (window.innerWidth < threshold) {
        useStore.setState({ sidebarOpen: false })
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [settings.adaptiveSidebar, settings.minWindowWidth]) // eslint-disable-line

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)] rounded-[10px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--chrome-border,#1e2022)]">

      {/* ── AppChrome — DaVinci-style unified titlebar + toolbar ── */}
      <AppChrome
        projectName={projectName}
        projectPath={projectPath}
        projectLanguage={projectLanguage}
        board={board}
        boards={BOARDS}
        onBoardChange={setBoard}
        onCheck={projectLanguage === 'go' ? handleCheck : undefined}
        onBuild={handleBuild}
        onFlash={handleFlash}
        onRun={handleRun}
        onMonitor={handleMonitor}
        theme={theme}
        onTheme={toggleTheme}
        onSettings={() => setScreen('settings')}
        onHome={() => setScreen('welcome')}
        onNew={() => setShowNewProjectModal(true)}
        sandboxEnabled={sandboxEnabled}
        workstationsEnabled={workstationsEnabled}
        sandboxOpen={sandboxOpen}
        onSandboxToggle={() => setSandboxOpen(o => !o)}
      />

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Activity bar */}
        <div className="w-10 flex flex-col items-center py-1.5 gap-0.5 border-r border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
          {[
            { id: 'files',    icon: <Files size={17} />,       tip: t('sidebar.explorer'),  show: true },
            { id: 'git',      icon: <GitBranch size={17} />,   tip: t('sidebar.git'),       show: settings.experimentsEnabled && settings.expGitEnabled },
            { id: 'packages', icon: <Package size={17} />,     tip: t('sidebar.packages'),  show: true },
            { id: 'examples', icon: <BookOpen size={17} />,    tip: 'Examples',             show: true },
            { id: 'explorer', icon: <FolderOpen size={17} />,  tip: 'File Explorer',        show: false /* TEMP HIDDEN */ },
          ].filter(item => item.show).map(({ id, icon, tip }) => (
            <button
              key={id} title={tip}
              onClick={() => toggleSidebar(id as any)}
              className={clsx(
                'w-8 h-8 flex items-center justify-center rounded cursor-pointer border-0 transition-colors relative',
                sidebarOpen && sidebarTab === id
                  ? 'text-[var(--fg)]'
                  : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
              )}
            >
              {sidebarOpen && sidebarTab === id && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--fg)] rounded-r" />
              )}
              {icon}
            </button>
          ))}
          <div className="flex-1" />
          <button
            title="Settings"
            onClick={() => setScreen('settings')}
            className="w-8 h-8 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] cursor-pointer border-0 bg-transparent transition-colors"
          >
            <Settings size={17} />
          </button>
        </div>

        {/* Left sidebar */}
        <div className={clsx(
          'bg-[var(--surface-1)] border-r border-[var(--border)] flex-shrink-0 overflow-hidden transition-[width] duration-150',
          sidebarOpen ? '' : 'w-0',
        )} style={sidebarOpen ? { width: settings.sidebarWidth } : {}}>
          {sidebarOpen && sidebarTab === 'files'    && <FilesSidebar />}
          {sidebarOpen && sidebarTab === 'git'      && <GitSidebar />}
          {sidebarOpen && sidebarTab === 'packages' && <PackagesSidebar />}
          {sidebarOpen && sidebarTab === 'examples' && <ExamplesSidebar />}
          {/* TEMP HIDDEN: {sidebarOpen && sidebarTab === 'explorer' && <FileExplorer />} */}
        </div>

        {/* Sidebar resize handle */}
        {sidebarOpen && (
          <div
            className="w-[3px] bg-transparent hover:bg-[var(--fg-faint)] cursor-col-resize flex-shrink-0 transition-colors group"
            onMouseDown={() => setResizingSidebar(true)}
            title="Drag to resize sidebar"
          >
            <div className={clsx('w-full h-full transition-colors', resizingSidebar && 'bg-[var(--fg-faint)]')} />
          </div>
        )}

        {/* ── Main content area ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Experimental board warning banner */}
          {board && EXPERIMENTAL_BOARDS[board] && (
            <div className="flex items-start gap-2 px-3 py-2 bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] border-b border-[color-mix(in_srgb,var(--warn)_25%,transparent)] flex-shrink-0">
              <AlertTriangle size={13} className="text-[var(--warn)] mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-[var(--fg-muted)] leading-snug flex-1">
                <span className="font-semibold text-[var(--warn)]">Soporte experimental:</span>{' '}
                {EXPERIMENTAL_BOARDS[board]}
              </p>
            </div>
          )}

          {/* When workstations are enabled, show the active workstation page */}
          {workstationsEnabled ? (
            <>
              {/* Code workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'code' && 'hidden')}>
                <CodeWorkstation
                  openTabs={openTabs}
                  activeTabIdx={activeTabIdx}
                  activeNode={activeNode}
                  parentNode={parentNode}
                  projectName={projectName}
                  openFile={openFile}
                  closeTab={closeTab}
                  saveActiveFile={saveActiveFile}
                  showContextMenu={showContextMenu}
                  t={t}
                />
              </div>

              {/* Sandbox workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'sandbox' && 'hidden')}>
                <SandboxWorkstation />
              </div>


              {/* Export workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'export' && 'hidden')}>
                <ErrorBoundary>
                  <ExportWorkstation />
                </ErrorBoundary>
              </div>

              {/* Bottom panel: always mounted to preserve terminal sessions, hidden via CSS on non-code workstations */}
              <div className={workstation !== 'code' ? 'hidden' : undefined}>
                <BottomPanel />
              </div>
            </>
          ) : (
            /* Legacy layout — editor + sandbox side panel */
            <>
              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* Editor column */}
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  {/* Tab bar */}
                  <div
                    className="flex items-end h-8 bg-[var(--surface-1)] border-b border-[var(--border)] overflow-x-auto flex-shrink-0 gap-0.5 px-1 pt-1"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {openTabs.map((tab, i) => (
                      <div
                        key={tab.fileId}
                        onClick={() => openFile(tab.fileId)}
                        onContextMenu={e => showContextMenu(e, [
                          { label: t('editor.closeTab'),    action: () => closeTab(i) },
                          { label: 'Copy filename', action: () => navigator.clipboard.writeText(tab.name).catch(() => {}), sep: true },
                          { label: t('editor.save'), shortcut: 'Ctrl+S', action: () => saveActiveFile() },
                        ])}
                        className={clsx(
                          'flex items-center gap-1.5 px-3 h-full rounded-t border-t cursor-pointer text-xs font-medium transition-colors flex-shrink-0 group',
                          i === activeTabIdx
                            ? 'bg-[var(--surface)] border-[var(--border)] border-x text-[var(--fg)]'
                            : 'bg-transparent border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                        )}
                      >
                        {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)]" />}
                        <span>{tab.name}</span>
                        <button
                          onClick={e => { e.stopPropagation(); closeTab(i) }}
                          className="w-4 h-4 flex items-center justify-center rounded transition-colors border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--active)] opacity-0 group-hover:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {activeNode && (
                    <div className="h-6 flex items-center px-3 gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface)] text-xs text-[var(--fg-muted)] flex-shrink-0">
                      <span>{projectName}</span>
                      {parentNode && (
                        <><ChevronRight size={10} className="text-[var(--fg-faint)]" />
                          <span>{parentNode.name}</span></>
                      )}
                      <ChevronRight size={10} className="text-[var(--fg-faint)]" />
                      <span className="text-[var(--fg)]">{activeNode.name}</span>
                    </div>
                  )}

                  <div className="flex-1 flex overflow-hidden">
                    <CodeEditor />
                  </div>
                </div>


                {/* Legacy sandbox side panel */}
                {sandboxEnabled && sandboxOpen && (
                  <>
                    <div
                      className="w-[3px] bg-[var(--border)] hover:bg-[var(--fg-faint)] cursor-col-resize flex-shrink-0 transition-colors"
                      onMouseDown={() => setResizingSandbox(true)}
                    />
                    <div
                      className="flex flex-col border-l border-[var(--border)] bg-[var(--surface)] flex-shrink-0 overflow-hidden"
                      style={{ width: sandboxWidth }}
                    >
                      <SandboxPanel onClose={() => setSandboxOpen(false)} />
                    </div>
                  </>
                )}

                {sandboxEnabled && !sandboxOpen && (
                  <div className="w-6 border-l border-[var(--border)] bg-[var(--surface-1)] flex flex-col items-center py-2 flex-shrink-0">
                    <button
                      onClick={() => setSandboxOpen(true)}
                      title="Open Tsuki Sandbox"
                      className="w-5 flex flex-col items-center gap-0 text-[var(--fg-faint)] hover:text-[var(--fg)] cursor-pointer border-0 bg-transparent transition-colors py-1"
                    >
                      <Cpu size={12} />
                      <span
                        className="text-[8px] font-semibold uppercase tracking-widest mt-2"
                        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                      >
                        Sandbox
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <BottomPanel />
            </>
          )}
        </div>
      </div>

      {/* ── Workstation bar (DaVinci-style) ── */}
      {workstationsEnabled && (
        <WorkstationBar
          active={workstation}
          onSelect={setWorkstation}
        />
      )}

      <StatusBar tsuki={tsuki} />

      {showNewProjectModal && (
        <NewProjectModal onClose={() => setShowNewProjectModal(false)} />
      )}
    </div>
  )
}

// ── Workstation bar ───────────────────────────────────────────────────────────

function WorkstationBar({
  active, onSelect,
}: {
  active: Workstation
  onSelect: (w: Workstation) => void
}) {
  return (
    <div className="h-9 flex items-center justify-center gap-0 border-t border-[var(--border)] bg-[var(--surface-2)] flex-shrink-0 px-2 select-none">
      <div className="flex items-center gap-px rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-3)]">
        {WORKSTATIONS.map((ws, i) => (
          <button
            key={ws.id}
            onClick={() => onSelect(ws.id)}
            title={`${ws.label} (Ctrl+${ws.shortcut})`}
            className={clsx(
              'flex items-center gap-1.5 px-4 h-7 text-xs font-semibold transition-all cursor-pointer border-0 relative',
              active === ws.id
                ? 'bg-[var(--surface-1)] text-[var(--fg)] shadow-sm'
                : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
              i > 0 && active !== ws.id && active !== WORKSTATIONS[i - 1].id && 'border-l border-[var(--border)]',
            )}
          >
            <ws.Icon size={13} />
            <span className="tracking-wide uppercase text-[10px]">{ws.label}</span>
            {active === ws.id && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--fg)]" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Code workstation ──────────────────────────────────────────────────────────

function CodeWorkstation({
  openTabs, activeTabIdx, activeNode, parentNode, projectName,
  openFile, closeTab, saveActiveFile, showContextMenu, t,
}: any) {
  return (
    <>
      {/* Tab bar */}
      <div
        className="flex items-end h-8 bg-[var(--surface-1)] border-b border-[var(--border)] overflow-x-auto flex-shrink-0 gap-0.5 px-1 pt-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {openTabs.map((tab: any, i: number) => (
          <div
            key={tab.fileId}
            onClick={() => openFile(tab.fileId)}
            onContextMenu={(e: React.MouseEvent) => showContextMenu(e, [
              { label: t('editor.closeTab'),    action: () => closeTab(i) },
              { label: 'Copy filename', action: () => navigator.clipboard.writeText(tab.name).catch(() => {}), sep: true },
              { label: t('editor.save'), shortcut: 'Ctrl+S', action: () => saveActiveFile() },
            ])}
            className={clsx(
              'flex items-center gap-1.5 px-3 h-full rounded-t border-t cursor-pointer text-xs font-medium transition-colors flex-shrink-0 group',
              i === activeTabIdx
                ? 'bg-[var(--surface)] border-[var(--border)] border-x text-[var(--fg)]'
                : 'bg-transparent border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            )}
          >
            {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)]" />}
            <span>{tab.name}</span>
            <button
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); closeTab(i) }}
              className="w-4 h-4 flex items-center justify-center rounded transition-colors border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--active)] opacity-0 group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Breadcrumb */}
      {activeNode && (
        <div className="h-6 flex items-center px-3 gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface)] text-xs text-[var(--fg-muted)] flex-shrink-0">
          <span>{projectName}</span>
          {parentNode && (
            <><ChevronRight size={10} className="text-[var(--fg-faint)]" />
              <span>{parentNode.name}</span></>
          )}
          <ChevronRight size={10} className="text-[var(--fg-faint)]" />
          <span className="text-[var(--fg)]">{activeNode.name}</span>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 flex overflow-hidden">
        <CodeEditor />
      </div>
    </>
  )
}

// ── Sandbox workstation ───────────────────────────────────────────────────────

function SandboxWorkstation() {
  const { settings, openTabs, activeTabIdx } = useStore()
  const sandboxEnabled = settings.experimentsEnabled && settings.expSandboxEnabled
  const [codeOpen, setCodeOpen] = useState(false)
  const [codeHeight, setCodeHeight] = useState(220)
  const draggingRef = useRef(false)
  const startYRef   = useRef(0)
  const startHRef   = useRef(0)

  const activeTab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null

  // Resize drag for the code panel
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return
      const delta = startYRef.current - e.clientY
      setCodeHeight(Math.max(80, Math.min(520, startHRef.current + delta)))
    }
    function onUp() {
      draggingRef.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  if (!sandboxEnabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--fg-faint)]">
        <Cpu size={32} className="opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium text-[var(--fg-muted)]">Sandbox not enabled</p>
          <p className="text-xs mt-1">Enable the <strong className="text-[var(--fg-muted)]">Sandbox</strong> experiment in Settings → Experiments.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* SandboxPanel takes remaining space */}
      <div className="flex-1 overflow-hidden min-h-0">
        <SandboxPanel fullscreen />
      </div>

      {/* ── Collapsible code panel ── */}
      <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--surface-1)] relative">

        {/* Resize grip — visible only when panel is open, sits on the top edge */}
        {codeOpen && (
          <div
            className="absolute top-0 left-0 right-0 h-1 cursor-row-resize z-10 hover:bg-[var(--fg-faint)] transition-colors"
            onMouseDown={e => {
              e.stopPropagation()
              draggingRef.current = true
              startYRef.current   = e.clientY
              startHRef.current   = codeHeight
              document.body.style.cursor     = 'row-resize'
              document.body.style.userSelect = 'none'
            }}
          />
        )}

        {/* Header — click to toggle */}
        <div
          className="h-7 flex items-center gap-2 px-3 select-none cursor-pointer hover:bg-[var(--hover)] transition-colors"
          onClick={() => setCodeOpen(o => !o)}
        >
          <ChevronRight
            size={11}
            className="text-[var(--fg-faint)] transition-transform flex-shrink-0"
            style={{ transform: codeOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
          <Code2 size={11} className="text-[var(--fg-faint)] flex-shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] flex-1">
            Code
          </span>
          {activeTab ? (
            <span className="text-[10px] font-mono text-[var(--fg-muted)] truncate max-w-[200px]">
              {activeTab.name}
              {activeTab.modified && <span className="ml-1 text-[var(--fg-faint)]">●</span>}
            </span>
          ) : (
            <span className="text-[10px] text-[var(--fg-faint)] italic">no file open</span>
          )}
        </div>

        {/* Code content */}
        {codeOpen && (
          <div
            className="overflow-auto border-t border-[var(--border)]"
            style={{ height: codeHeight }}
          >
            {activeTab ? (
              <pre
                className="p-3 text-xs font-mono leading-5 text-[var(--fg-muted)] whitespace-pre min-h-full m-0"
                style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", Consolas, monospace)' }}
              >
                {activeTab.content || (
                  <span className="text-[var(--fg-faint)] italic not-italic">empty file</span>
                )}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--fg-faint)] italic">
                Open a file in the editor to preview it here
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// ── Status bar ─────────────────────────────────────────────────────────────────

function StatusBar({ tsuki }: { tsuki: string }) {
  const { board, backend, gitBranch, openTabs, activeTabIdx, problems } = useStore()
  const [cursor, setCursor] = useState('Ln 1, Col 1')

  useEffect(() => {
    const id = setInterval(() => {
      const c = (window as any).__gdi_cursor
      if (c) setCursor(c)
    }, 300)
    return () => clearInterval(id)
  }, [])

  const errCount  = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length
  const activeTab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null

  return (
    <div className="h-5 flex items-center px-3 gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] flex-shrink-0 select-none">
      <div className="flex items-center gap-3 text-2xs text-[var(--fg-faint)] font-mono">
        <span className="flex items-center gap-1"><GitBranch size={9} /> {gitBranch}</span>
        {(errCount + warnCount) > 0 ? (
          <span className="flex items-center gap-1.5">
            {errCount  > 0 && <span className="text-[var(--err)]">✗ {errCount}</span>}
            {warnCount > 0 && <span className="text-[var(--warn)]">⚠ {warnCount}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ok)]" /> <span style={{ color: 'var(--ok)' }}>月</span> ready
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 text-2xs text-[var(--fg-faint)] font-mono">
        <span>{tsuki}</span>
        <span>{backend}</span>
        <span>board: {board}</span>
        {activeTab && <span>{activeTab.ext || 'go'}</span>}
        <span>{cursor}</span>
      </div>
    </div>
  )
}