'use client'
import { useStore } from '@/lib/store'
import NewProjectModal from '@/components/other/NewProjectModal'
import { useState, useEffect, useRef } from 'react'
import { Btn, Divider } from '@/components/shared/primitives'
import FilesSidebar from '@/components/other/FilesSidebar'
import PackagesSidebar from '@/components/other/PackagesSidebar'
import ExamplesSidebar from '@/components/other/ExamplesSidebar'
import CodeEditor from '@/components/other/CodeEditor'
import BottomPanel from '@/components/other/BottomPanel'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import {
  Files, GitBranch, Settings, Home, Check, Zap, Upload, Play, Plus,
  Terminal, Sun, Moon, X, ChevronRight, Package, Cpu, BookOpen,
  Code2, Share2, Layers, AlertTriangle,
} from 'lucide-react'
import type { ElementType } from 'react'
import { clsx } from 'clsx'
import TsukiLogo from '@/components/shared/TsukiLogo'
import { showContextMenu } from '@/components/shared/ContextMenu'
import { useT } from '@/lib/i18n'
import { usePlugins } from '@/lib/usePlugins'
import PluginPermissionsModal from '@/components/plugins/PluginPermissionModal'
import PluginSlot, {
  usePluginSidebarTabs,
  usePluginWorkstations,
  usePluginStatusBarItems,
  PluginSidebarTab,
  PluginWorkstation,
  PluginStatusBarItem,
} from '@/components/plugins/PluginSlot'

const BOARDS = [
  'uno','nano','nano_old','mega','leonardo','micro','pro_mini_5v','pro_mini_3v3',
  'esp32','esp32s2','esp32c3','esp8266','d1_mini','nodemcu','pico','xiao_rp2040',
]

const EXPERIMENTAL_BOARDS: Record<string, string> = {
  pico: 'El soporte para Raspberry Pi Pico (RP2040) es experimental. Requiere el core earlephilhower instalado en arduino-cli.',
}

// ── Workstation pages ─────────────────────────────────────────────────────────
// Only built-in workstations here. Sandbox, and any future workstations,
// are registered by installed ide-plugin packages via the plugin system.

const WORKSTATIONS: { id: string; label: string; Icon: ElementType; shortcut: string }[] = [
  { id: 'code',   label: 'Code',   Icon: Code2,  shortcut: '1' },
  { id: 'export', label: 'Export', Icon: Share2, shortcut: '3' },
]

export default function IdeScreen() {
  const {
    projectName, projectPath, projectLanguage, board, backend, setBoard, setScreen,
    sidebarOpen, sidebarTab, toggleSidebar,
    openTabs, activeTabIdx, closeTab, openFile,
    tree, toggleTheme, theme,
    settings, updateSetting, setBottomTab, saveActiveFile, dispatchCommand, dispatchBuild,
  } = useStore()

  const t = useT()
  const { consentRequest, dismissConsent } = usePlugins()
  const pluginSidebarTabs  = usePluginSidebarTabs()
  const pluginWorkstations = usePluginWorkstations()
  const pluginStatusLeft   = usePluginStatusBarItems('left')
  const pluginStatusRight  = usePluginStatusBarItems('right')
  // Active plugin sidebar tab (separate from built-in sidebarTab)
  const [activePluginTab,   setActivePluginTab]   = useState<string | null>(null)

  const [showNewProjectModal, setShowNewProjectModal] = useState(false)

  // Legacy sandbox side panel state kept for backward compat
  // (only shown when workstations experiment is OFF and sandbox plugin installed)
  const [sandboxOpen,       setSandboxOpen]       = useState(false)
  const [sandboxWidth,      setSandboxWidth]       = useState(480)
  const [resizingSandbox,   setResizingSandbox]   = useState(false)
  const [resizingSidebar,   setResizingSidebar]   = useState(false)

  // Workstation — string to support plugin-registered workstation IDs
  const [workstation, setWorkstation] = useState<string>('code')

  const workstationsEnabled = settings.experimentsEnabled && settings.expWorkstationsEnabled
  // Auto-switch to sandbox workstation when a circuit is dispatched from Examples.
  // 'sandbox' is the id registered by ide-sandbox plugin — if not installed, this is a no-op.
  const { pendingCircuit, clearPendingCircuit } = useStore(s => ({ pendingCircuit: s.pendingCircuit, clearPendingCircuit: s.clearPendingCircuit }))
  useEffect(() => {
    if (!pendingCircuit) return
    clearPendingCircuit()
    if (workstationsEnabled) setWorkstation('sandbox')
    else setSandboxOpen(true)
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
      // Workstation shortcuts: Ctrl+digit when workstations enabled
      if (workstationsEnabled) {
        if (e.key === '1') { setWorkstation('code');   return }
        if (e.key === '3') { setWorkstation('export'); return }
        // Plugin workstations use their declared shortcut key
        for (const ws of pluginWorkstations) {
          if (ws.shortcut && e.key === ws.shortcut) { setWorkstation(ws.id); return }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tsuki, board, cwd, settings.verbose, settings.defaultBaud, workstationsEnabled]) // eslint-disable-line

  useEffect(() => {
    const { addLog } = useStore.getState()
    addLog('info', `IDE ready · project: ${projectName || '(none)'} · board: ${board} · lang: ${projectLanguage}`)
    addLog('info', `Experiments: sandbox=${settings.expSandboxEnabled} git=${settings.expGitEnabled} lsp=${settings.expLspEnabled}`)

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
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">

      {/* ── Topbar ── */}
      <div className="topbar flex items-center gap-1 px-2 border-b border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)]">

        <div className="flex items-center gap-2 mr-1 min-w-0 max-w-[240px]">
          <TsukiLogo size="sm" />
          <div className="min-w-0">
            <div className="font-semibold text-sm tracking-tight leading-none truncate">
              {projectName || 'Tsuki'}
            </div>
            {projectPath && (
              <div className="text-[9px] text-[var(--fg-faint)] font-mono leading-none mt-0.5 truncate">
                {projectPath}
              </div>
            )}
          </div>
        </div>

        <Divider vertical />

        <select
          value={board}
          onChange={e => setBoard(e.target.value)}
          className="bg-transparent border border-[var(--border)] rounded px-2 py-0.5 text-xs text-[var(--fg-muted)] outline-none cursor-pointer appearance-none hover:border-[var(--fg-faint)] transition-colors flex-shrink-0"
        >
          {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>

        <Divider vertical />

        {projectLanguage === 'go' && (
          <Btn variant="ghost" size="xs" onClick={handleCheck}
            title={`${tsuki} check${board ? ' --board ' + board : ''}`}>
            <Check size={12} /><span className="topbar-label ml-1">{t('topbar.check')}</span>
          </Btn>
        )}

        <Btn variant="ghost" size="xs" onClick={handleBuild}
          title={`${tsuki} build --compile${board ? ' --board ' + board : ''}`}>
          <Zap size={12} /><span className="topbar-label ml-1">{t('topbar.build')}</span>
        </Btn>

        <Btn variant="ghost" size="xs" onClick={handleFlash}
          title={`${tsuki} flash${board ? ' --board ' + board : ''}`}
          className="!text-green-400 hover:!text-green-400">
          <Upload size={12} /><span className="topbar-label ml-1">{t('topbar.flash')}</span>
        </Btn>

        <button
          onClick={handleRun}
          title={`${tsuki} build --compile && ${tsuki} flash`}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--fg)] text-[var(--accent-inv)] text-xs font-semibold hover:opacity-80 transition-opacity cursor-pointer border-0 flex-shrink-0"
        >
          <Play size={11} /> Run
        </button>

        <Divider vertical />

        <Btn variant="ghost" size="xs" onClick={handleMonitor}
          title={`${tsuki} monitor${settings.defaultBaud !== '9600' ? ' --baud ' + settings.defaultBaud : ''}`}>
          <Terminal size={12} /><span className="topbar-label-sm ml-1">{t('topbar.monitor')}</span>
        </Btn>

        {/* Plugin toolbar actions */}
        <PluginSlot slot="toolbar-action" />

        <div className="flex-1" />

        <Btn variant="ghost" size="xs" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </Btn>
        <Btn variant="ghost" size="xs" onClick={() => setScreen('settings')}>
          <Settings size={13} />
        </Btn>
        <Btn variant="ghost" size="xs" title={t('topbar.newProject')} onClick={() => setShowNewProjectModal(true)}>
          <Plus size={13} />
        </Btn>
        <Btn variant="ghost" size="xs" onClick={() => setScreen('welcome')}>
          <Home size={13} />
        </Btn>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Activity bar */}
        <div className="w-10 flex flex-col items-center py-1.5 gap-0.5 border-r border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
          {[
            { id: 'files',    icon: <Files size={17} />,    tip: t('sidebar.explorer'), show: true },
            { id: 'packages', icon: <Package size={17} />,  tip: t('sidebar.packages'), show: true },
            { id: 'examples', icon: <BookOpen size={17} />, tip: 'Examples',             show: true },
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

          {/* Plugin sidebar tabs (e.g. ide-git registers one here) */}
          {pluginSidebarTabs.map(({ id, label, icon }) => {
            const isActive = sidebarOpen && activePluginTab === id
            return (
              <button
                key={id} title={label}
                onClick={() => {
                  if (isActive) {
                    setActivePluginTab(null)
                    useStore.setState({ sidebarOpen: false })
                  } else {
                    setActivePluginTab(id)
                    useStore.setState({ sidebarOpen: true, sidebarTab: '__plugin__' as any })
                  }
                }}
                className={clsx(
                  'w-8 h-8 flex items-center justify-center rounded cursor-pointer border-0 transition-colors relative text-xs',
                  isActive
                    ? 'text-[var(--fg)]'
                    : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
                )}
              >
                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[var(--fg)] rounded-r" />}
                {icon ? <span style={{ fontSize: 14 }}>{icon}</span> : <span style={{ fontSize: 10 }}>{label.slice(0, 2)}</span>}
              </button>
            )
          })}
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
          {sidebarOpen && sidebarTab === 'packages' && <PackagesSidebar />}
          {sidebarOpen && sidebarTab === 'examples' && <ExamplesSidebar />}
          {/* Plugin sidebar panels (e.g. ide-git renders here) */}
          {sidebarOpen && activePluginTab && pluginSidebarTabs.map(tab => (
            <PluginSidebarTab
              key={tab.id}
              pluginId={tab.pluginId}
              tabId={tab.id}
              label={tab.label}
              icon={tab.icon}
              active={activePluginTab === tab.id}
              onActivate={() => setActivePluginTab(tab.id)}
              renderContent={tab.renderContent}
            />
          ))}
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
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 flex-shrink-0">
              <AlertTriangle size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-amber-300/90 leading-snug flex-1">
                <span className="font-semibold text-amber-300">Soporte experimental:</span>{' '}
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

              {/* Sandbox workstation — rendered by ide-sandbox plugin if installed */}
              {/* Plugin workstations (sandbox, webkit, etc.) */}
              {pluginWorkstations.map(ws => (
                <PluginWorkstation
                  key={ws.id}
                  workstationId={ws.id}
                  active={workstation === ws.id}
                  renderContent={ws.renderContent}
                />
              ))}

              {/* Export workstation */}
              <div className={clsx('flex-1 flex flex-col overflow-hidden min-h-0', workstation !== 'export' && 'hidden')}>
                <ExportWorkstation board={board} projectName={projectName} />
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
              </div>

              <BottomPanel />
            </>
          )}
        </div>
      </div>

      {/* ── Workstation bar (DaVinci-style) — only when experiment enabled ── */}
      {workstationsEnabled && (
        <WorkstationBar
          active={workstation}
          onSelect={setWorkstation}
          pluginWorkstations={pluginWorkstations}
        />
      )}

      <StatusBar tsuki={tsuki} />

      {showNewProjectModal && (
        <NewProjectModal onClose={() => setShowNewProjectModal(false)} />
      )}

      {/* Plugin permissions consent dialog */}
      {consentRequest && (
        <PluginPermissionsModal
          meta={consentRequest.meta}
          onGrant={granted => dismissConsent(granted)}
          onDeny={() => dismissConsent(new Set())}
        />
      )}
    </div>
  )
}

// ── Workstation bar ───────────────────────────────────────────────────────────

type PluginWs = { id: string; label: string; icon?: string; shortcut?: string; renderContent: () => HTMLElement; pluginId: string }

function WorkstationBar({
  active, onSelect, pluginWorkstations,
}: {
  active: string
  onSelect: (w: string) => void
  pluginWorkstations: PluginWs[]
}) {
  const allWs = [...WORKSTATIONS, ...pluginWorkstations.map(pw => ({
    id: pw.id, label: pw.label, shortcut: pw.shortcut ?? '', Icon: null as any,
  }))]
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
        {/* Plugin workstation buttons */}
        {pluginWorkstations.map(ws => (
          <button
            key={ws.id}
            onClick={() => onSelect(ws.id)}
            title={ws.shortcut ? `${ws.label} (Ctrl+${ws.shortcut})` : ws.label}
            className={clsx(
              'flex items-center gap-1.5 px-4 h-7 text-xs font-semibold transition-all cursor-pointer border-0 relative border-l border-[var(--border)]',
              active === ws.id
                ? 'bg-[var(--surface-1)] text-[var(--fg)] shadow-sm'
                : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]',
            )}
          >
            {ws.icon && <span style={{ fontSize: 13 }}>{ws.icon}</span>}
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



// ── Export workstation ────────────────────────────────────────────────────────

function ExportWorkstation({ board, projectName }: { board: string; projectName: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-[var(--fg-faint)]">
      <Share2 size={32} className="opacity-30" />
      <div className="text-center max-w-sm">
        <p className="text-sm font-semibold text-[var(--fg-muted)] mb-1">Export workstation</p>
        <p className="text-xs leading-relaxed">
          Release builds, OTA packaging, and deployment options will appear here.
          <br />
          <span className="text-[var(--fg-faint)] opacity-60 italic mt-2 block">Coming soon.</span>
        </p>
      </div>
      {projectName && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-xs font-mono text-[var(--fg-muted)]">
          <span className="text-[var(--fg-faint)]">project</span>
          <span className="text-[var(--fg)]">{projectName}</span>
          <span className="text-[var(--fg-faint)]">board</span>
          <span className="text-[var(--fg)]">{board}</span>
        </div>
      )}
    </div>
  )
}

// ── Status bar ─────────────────────────────────────────────────────────────────

function StatusBar({ tsuki }: { tsuki: string }) {
  const { board, backend, gitBranch, openTabs, activeTabIdx, problems } = useStore()
  const [cursor, setCursor] = useState('Ln 1, Col 1')
  const pluginLeft  = usePluginStatusBarItems('left')
  const pluginRight = usePluginStatusBarItems('right')

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
            {errCount  > 0 && <span className="text-red-400">✗ {errCount}</span>}
            {warnCount > 0 && <span className="text-yellow-400">⚠ {warnCount}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> <span style={{ color: '#4ade80' }}>月</span> ready
          </span>
        )}
        {pluginLeft.map(item => (
          <PluginStatusBarItem key={item.id} itemId={item.id} renderContent={item.renderContent} />
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 text-2xs text-[var(--fg-faint)] font-mono">
        {pluginRight.map(item => (
          <PluginStatusBarItem key={item.id} itemId={item.id} renderContent={item.renderContent} />
        ))}
        <span>{tsuki}</span>
        <span>{backend}</span>
        <span>board: {board}</span>
        {activeTab && <span>{activeTab.ext || 'go'}</span>}
        <span>{cursor}</span>
      </div>
    </div>
  )
}