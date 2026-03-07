'use client'
import { useStore } from '@/lib/store'
import NewProjectModal from '@/components/other/NewProjectModal'
import { useState, useEffect } from 'react'
import { Btn, Divider } from '@/components/shared/primitives'
import FilesSidebar from '@/components/other/FilesSidebar'
import GitSidebar from '@/components/experiments/GitSidebar/GitSidebar'
import PackagesSidebar from '@/components/other/PackagesSidebar'
import ExamplesSidebar from '@/components/experiments/ExamplesSidebar/ExamplesSidebar'
import CodeEditor from '@/components/other/CodeEditor'
import BottomPanel from '@/components/other/BottomPanel'
import SandboxPanel from '@/components/experiments/SandboxPanel/SandboxPanel'
import {
  Files, GitBranch, Settings, Home, Check, Zap, Upload, Play, Plus,
  Terminal, Sun, Moon, X, ChevronRight, Package, Cpu, ChevronLeft, BookOpen,
} from 'lucide-react'
import { clsx } from 'clsx'
import TsukiLogo from '@/components/shared/TsukiLogo'
import { showContextMenu } from '@/components/shared/ContextMenu'
import { useT } from '@/lib/i18n'

const BOARDS = [
  'uno','nano','nano_old','mega','leonardo','micro','pro_mini_5v','pro_mini_3v3',
  'esp32','esp32s2','esp32c3','esp8266','d1_mini','nodemcu','pico',
]

export default function IdeScreen() {
  const {
    projectName, projectPath, board, backend, setBoard, setScreen,
    sidebarOpen, sidebarTab, toggleSidebar,
    openTabs, activeTabIdx, closeTab, openFile,
    tree, toggleTheme, theme,
    settings, setBottomTab, saveActiveFile, dispatchCommand,
  } = useStore()

  const t = useT()
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [sandboxWidth, setSandboxWidth] = useState(480)
  const [resizing, setResizing] = useState(false)

  // Auto-open sandbox when a circuit is dispatched from Examples panel
  const pendingCircuit = useStore(s => s.pendingCircuit)
  useEffect(() => {
    if (pendingCircuit && settings.experimentsEnabled && settings.expSandboxEnabled) {
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

  function dispatch(args: string[]) {
    setBottomTab('terminal')
    dispatchCommand(tsuki, args, cwd)
  }

  function handleCheck() {
    const args = ['check']
    if (board) args.push('--board', board)
    if (settings.verbose) args.push('--verbose')
    dispatch(args)
  }

  function handleBuild() {
    const args = ['build', '--compile']
    if (board)            args.push('--board', board)
    if (settings.verbose) args.push('--verbose')
    dispatch(args)
  }

  function handleFlash() {
    const args = ['upload']
    if (board)            args.push('--board', board)
    if (settings.verbose) args.push('--verbose')
    dispatch(args)
  }

  function handleRun() {
    setBottomTab('terminal')
    const buildArgs = ['build', '--compile']
    if (board)            buildArgs.push('--board', board)
    if (settings.verbose) buildArgs.push('--verbose')
    const flashArgs = ['upload']
    if (board)            flashArgs.push('--board', board)
    if (settings.verbose) flashArgs.push('--verbose')
    // Chain: build first, flash only on success — BottomPanel handles the await
    dispatchCommand(tsuki, buildArgs, cwd, flashArgs)
  }

  function handleMonitor() {
    const args = ['monitor']
    if (settings.defaultBaud && settings.defaultBaud !== '9600') args.push('--baud', settings.defaultBaud)
    if (settings.verbose) args.push('--verbose')
    dispatch(args)
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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const currentPath = settings.tsukiPath?.trim()
    const isAbsolutePath = currentPath?.includes('\\') || currentPath?.includes('/')
    if (!isAbsolutePath) {
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
    }
  }, [])

  // ── Sandbox resize handle ──
  useEffect(() => {
    if (!resizing) return
    function onMove(e: MouseEvent) {
      setSandboxWidth(w => Math.max(320, Math.min(900, w + (document.body.clientWidth - e.clientX - w))))
    }
    function onUp() { setResizing(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [resizing])

  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">

      {/* ── Topbar ── */}
      <div className="h-10 flex items-center gap-1 px-3 border-b border-[var(--border)] flex-shrink-0 bg-[var(--surface-1)]">

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

        <Btn variant="ghost" size="xs" onClick={handleCheck}
          title={`${tsuki} check${board ? ' --board ' + board : ''}`}>
          <Check size={12} /> {t('topbar.check')}
        </Btn>

        <Btn variant="ghost" size="xs" onClick={handleBuild}
          title={`${tsuki} build --compile${board ? ' --board ' + board : ''}`}>
          <Zap size={12} /> {t('topbar.build')}
        </Btn>

        <Btn variant="ghost" size="xs" onClick={handleFlash}
          title={`${tsuki} flash${board ? ' --board ' + board : ''}`}
          className="!text-green-400 hover:!text-green-400">
          <Upload size={12} /> {t('topbar.flash')}
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
          <Terminal size={12} /> {t('topbar.monitor')}
        </Btn>

        <div className="flex-1" />

        {/* ── Sandbox toggle (only when experiment enabled) ── */}
        {settings.experimentsEnabled && settings.expSandboxEnabled && (
        <button
          onClick={() => setSandboxOpen(o => !o)}
          title="Tsuki Sandbox — Arduino circuit simulator"
          className={clsx(
            'flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium transition-colors cursor-pointer flex-shrink-0',
            sandboxOpen
              ? 'bg-[var(--active)] border-[var(--border)] text-[var(--fg)]'
              : 'bg-transparent border-[var(--border)] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
          )}
        >
          <Cpu size={11} />
          {t('topbar.sandbox')}
          <span className="text-[9px] opacity-60 font-mono">β</span>
        </button>
        )}

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
      <div className="flex flex-1 overflow-hidden">

        {/* Activity bar */}
        <div className="w-10 flex flex-col items-center py-1.5 gap-0.5 border-r border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
          {[
            { id: 'files',    icon: <Files size={17} />,     tip: t('sidebar.explorer'),  show: true },
            { id: 'git',      icon: <GitBranch size={17} />, tip: t('sidebar.git'),       show: settings.experimentsEnabled && settings.expGitEnabled },
            { id: 'packages', icon: <Package size={17} />,   tip: t('sidebar.packages'),  show: true },
            { id: 'examples', icon: <BookOpen size={17} />,  tip: 'Examples',             show: true },
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
          'bg-[var(--surface-1)] border-r border-[var(--border)] flex-shrink-0 overflow-hidden transition-all duration-150',
          sidebarOpen ? 'w-56' : 'w-0',
        )}>
          {sidebarOpen && sidebarTab === 'files'    && <FilesSidebar />}
          {sidebarOpen && sidebarTab === 'git'      && <GitSidebar />}
          {sidebarOpen && sidebarTab === 'packages' && <PackagesSidebar />}
          {sidebarOpen && sidebarTab === 'examples' && <ExamplesSidebar />}
        </div>

        {/* Editor + bottom panel */}
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
                  { label: t('editor.closeOthers'), action: () => openTabs.forEach((_, j) => j !== i && closeTab(j > i ? openTabs.length - 1 - (j - i) : j)), sep: false },
                  { label: 'Copy filename',     action: () => navigator.clipboard.writeText(tab.name).catch(() => {}), sep: true },
                  { label: t('editor.save'),    shortcut: 'Ctrl+S', action: () => saveActiveFile() },
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

          <div className="flex-1 flex overflow-hidden">
            <CodeEditor />
          </div>

          <BottomPanel />
        </div>

        {/* ── Sandbox right panel (experiment-gated) ── */}
        {settings.experimentsEnabled && settings.expSandboxEnabled && sandboxOpen && (
          <>
            {/* Resize handle */}
            <div
              className="w-[3px] bg-[var(--border)] hover:bg-[var(--fg-faint)] cursor-col-resize flex-shrink-0 transition-colors"
              onMouseDown={() => setResizing(true)}
            />
            {/* Panel */}
            <div
              className="flex flex-col border-l border-[var(--border)] bg-[var(--surface)] flex-shrink-0 overflow-hidden"
              style={{ width: sandboxWidth }}
            >
              <SandboxPanel onClose={() => setSandboxOpen(false)} />
            </div>
          </>
        )}

        {/* Collapsed sandbox tab (experiment-gated) */}
        {settings.experimentsEnabled && settings.expSandboxEnabled && !sandboxOpen && (
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

      <StatusBar tsuki={tsuki} />

      {showNewProjectModal && (
        <NewProjectModal onClose={() => setShowNewProjectModal(false)} />
      )}
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
            {errCount  > 0 && <span className="text-red-400">✗ {errCount}</span>}
            {warnCount > 0 && <span className="text-yellow-400">⚠ {warnCount}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> <span style={{ color: '#4ade80' }}>月</span> ready
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3 text-2xs text-[var(--fg-faint)] font-mono">
        <span>{tsuki}</span>
        <span>{backend}</span>
        <span>board: {board}</span>
        {activeTab && <span>go</span>}
        <span>{cursor}</span>
      </div>
    </div>
  )
}