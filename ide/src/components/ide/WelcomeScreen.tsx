'use client'
import { useState } from 'react'
import NewProjectModal from '@/components/ide/NewProjectModal'
import { useStore } from '@/lib/store'
import { Btn } from '@/components/ui/primitives'
import { Plus, FolderOpen, Settings, Clock, ChevronRight } from 'lucide-react'




export default function WelcomeScreen() {
  const { setScreen, loadProject, loadFromDisk, toggleTheme, theme, recentProjects } = useStore()
  const [opening, setOpening] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)


  async function openFolder() {
    setOpening(true)
    try {
      const { pickFolder, isTauri } = await import('@/lib/tauri')
      if (!isTauri()) {
        console.error('[tsuki-ide] openFolder: no estamos en Tauri')
        setOpening(false)
        return
      }
      const folder = await pickFolder()
      if (!folder) { setOpening(false); return }
      await loadFromDisk(folder)
    } catch (e) {
      console.error('[tsuki-ide] openFolder error:', e)
    }
    setOpening(false)
  }


  return (
    <div className="h-screen flex flex-col bg-[var(--surface)] text-[var(--fg)]">
      {/* Titlebar */}
      <div className="h-11 flex items-center px-5 border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-[var(--fg)] flex items-center justify-center">
            <span className="text-[var(--surface)] font-mono font-bold text-[10px] leading-none">G</span>
          </div>
          <span className="font-semibold text-sm tracking-tight">Tsuki</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Btn variant="ghost" size="xs" onClick={toggleTheme} className="font-mono text-[10px]">
            {theme === 'dark' ? '◐' : '○'}
          </Btn>
          <Btn variant="ghost" size="xs" onClick={() => setScreen('settings')}>
            <Settings size={13} />
          </Btn>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center px-8 overflow-auto">
        <div className="w-full max-w-[520px] flex flex-col gap-8 items-start py-10">

          {/* Left */}
          <div className="flex-1 min-w-0 animate-fade-up">
            <h1 className="text-2xl font-semibold tracking-tight mb-1.5">Tsuki IDE</h1>
            <p className="text-sm text-[var(--fg-muted)] mb-8">
              Write in Go · Compile to C++ · Flash to Arduino
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-1.5 mb-8">
              <button
                onClick={() => setShowNewModal(true)}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md bg-[var(--fg)] text-[var(--accent-inv)] text-sm font-semibold hover:opacity-85 transition-opacity cursor-pointer border-0"
              >
                <Plus size={14} />
                New Project
              </button>
              <button
                onClick={openFolder}
                disabled={opening}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent disabled:opacity-50"
              >
                <FolderOpen size={14} />
                {opening ? 'Opening…' : 'Open Folder'}
              </button>
              <button
                onClick={() => setScreen('settings')}
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
              >
                <Settings size={14} />
                Settings &amp; CLI Config
              </button>
            </div>

            {/* Recent */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock size={11} className="text-[var(--fg-faint)]" />
                <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest">Recent</span>
              </div>
              <div className="flex flex-col">
                {recentProjects.length === 0 && (
                  <p className="text-xs text-[var(--fg-faint)] px-2">No recent projects yet.</p>
                )}
                {recentProjects.map(r => (
                  <button
                    key={r.path}
                    onClick={() => loadFromDisk(r.path)}
                    className="flex items-center gap-3 px-2.5 py-2 rounded-md hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent text-left group"
                  >
                    <div className="w-7 h-7 rounded border border-[var(--border)] flex items-center justify-center text-[var(--fg-faint)] flex-shrink-0">
                      <span className="font-mono text-[10px] font-bold">go</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--fg)] truncate">{r.name}</div>
                      <div className="text-xs text-[var(--fg-faint)] truncate font-mono">{r.path}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-mono text-[var(--fg-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                        {r.board}
                      </span>
                      <ChevronRight size={12} className="text-[var(--fg-faint)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

</div>
      </div>

      {/* Footer */}
      <div className="h-8 flex items-center px-5 border-t border-[var(--border)] flex-shrink-0">
        <span className="text-xs text-[var(--fg-faint)] font-mono">v0.1.0</span>
        <span className="ml-auto text-xs text-[var(--fg-faint)]">Tauri · Next.js · Go</span>
      </div>

      {/* New project modal */}
      {showNewModal && (
        <NewProjectModal onClose={() => setShowNewModal(false)} />
      )}
    </div>
  )
}