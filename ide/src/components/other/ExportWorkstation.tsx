'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import type { FileNode } from '@/lib/store'
import { clsx } from 'clsx'
import {
  Archive, Github, Container, Radio, Tag, HardDrive,
  ChevronRight, Check, AlertTriangle, Loader2,
  Folder, FileCode, FileText, File, Binary,
  LayoutGrid, List, Settings2, Play, Package, Cpu,
  Wrench, Home, ArrowLeft,
} from 'lucide-react'
import { spawnProcess } from '@/lib/tauri'

type ExportFormat = 'zip' | 'github' | 'docker' | 'ota' | 'release' | 'portable'
type JobStatus    = 'idle' | 'running' | 'done' | 'error'

interface LogLine { id: number; text: string; kind: 'out' | 'err' | 'sys' }
let _lid = 0
const mkLine = (text: string, kind: LogLine['kind'] = 'out'): LogLine => ({ id: _lid++, text, kind })

interface VNode {
  name:     string
  type:     'file' | 'dir'
  virtual?: boolean
  ext?:     string
  children?: VNode[]
}

const FORMATS: { id: ExportFormat; label: string; Icon: React.ElementType; accent: string }[] = [
  { id: 'zip',      label: 'ZIP',       Icon: Archive,   accent: '#61afef' },
  { id: 'github',   label: 'GitHub',    Icon: Github,    accent: '#c678dd' },
  { id: 'docker',   label: 'Docker',    Icon: Container, accent: '#56b6c2' },
  { id: 'ota',      label: 'OTA Flash', Icon: Radio,     accent: '#e5c07b' },
  { id: 'release',  label: 'Release',   Icon: Tag,       accent: '#98c379' },
  { id: 'portable', label: 'Portable',  Icon: HardDrive, accent: '#e06c75' },
]

function storeToVNodes(tree: FileNode[], parentId: string): VNode[] {
  const parent = tree.find(n => n.id === parentId)
  if (!parent || parent.type !== 'dir') return []
  return (parent.children ?? [])
    .map(id => tree.find(n => n.id === id)).filter(Boolean).map(n => n!)
    .sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name))
    .map(n => ({ name: n.name, type: n.type, ext: n.ext, children: n.type === 'dir' ? storeToVNodes(tree, n.id) : undefined }))
}

const vf = (name: string, type: VNode['type'] = 'file', children?: VNode[]): VNode =>
  ({ name, type, virtual: true, ext: name.includes('.') ? name.split('.').pop() : undefined, children })

function buildTree(fmt: ExportFormat, tree: FileNode[], projectName: string, board: string, version: string): VNode {
  const src = storeToVNodes(tree, 'root')
  switch (fmt) {
    case 'zip':      return { name: `${projectName || 'project'}.zip`, type: 'dir', children: [{ name: 'src', type: 'dir', children: src }, vf('build', 'dir', [vf('firmware.hex'), vf('sketch.cpp')]), vf('tsuki_package.json'), vf('README.md')] }
    case 'github':   return { name: projectName || 'project', type: 'dir', children: [{ name: 'src', type: 'dir', children: src }, vf('.gitignore'), vf('README.md'), vf('tsuki_package.json')] }
    case 'docker':   return { name: `${projectName || 'project'}-image`, type: 'dir', children: [vf('Dockerfile'), vf('.dockerignore'), { name: 'src', type: 'dir', children: src }, vf('tsuki_package.json')] }
    case 'ota':      return { name: 'ota-flash', type: 'dir', children: [vf(`firmware-${board || 'board'}.hex`), vf('targets.json'), vf('flash.sh')] }
    case 'release':  return { name: `release/v${version}`, type: 'dir', children: [vf(`${projectName || 'project'}-v${version}.zip`), vf(`firmware-${board || 'board'}.hex`), vf('CHANGELOG.md'), vf('manifest.json')] }
    case 'portable': return { name: `${projectName || 'project'}-portable`, type: 'dir', children: [{ name: 'src', type: 'dir', children: src }, vf('build', 'dir', [vf('firmware.hex'), vf('sketch.cpp')]), vf('sdk', 'dir', [vf('avr-gcc', 'dir', [vf('bin', 'dir', [])])]), vf('tools', 'dir', [vf('tsuki'), vf('tsuki-flash')]), vf('tsuki_package.json')] }
  }
}

function countFiles(n: VNode): number { return n.type === 'file' ? 1 : (n.children ?? []).reduce((s, c) => s + countFiles(c), 0) }

function VIcon({ node }: { node: VNode }) {
  const e = node.ext ?? ''
  if (['go','cpp','c','h','py'].includes(e)) return <FileCode size={13} className="flex-shrink-0 text-sky-400" />
  if (['json','toml','yaml','yml'].includes(e)) return <FileText size={13} className="flex-shrink-0 text-yellow-400" />
  if (e === 'md') return <FileText size={13} className="flex-shrink-0 text-emerald-400" />
  if (['hex','bin','elf','uf2'].includes(e)) return <Binary size={13} className="flex-shrink-0 text-purple-400" />
  if (node.name === 'Dockerfile' || node.name === '.dockerignore') return <Container size={13} className="flex-shrink-0 text-cyan-400" />
  if (node.name === 'tsuki' || node.name === 'tsuki-flash' || e === 'sh') return <Wrench size={13} className="flex-shrink-0 text-orange-400" />
  return <File size={13} className="flex-shrink-0 text-[var(--fg-faint)]" />
}

// ── Breadcrumb shared ────────────────────────────────────────────────────────
function Breadcrumb({ path, onGoTo }: { path: VNode[]; onGoTo: (i: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-2 h-7 border-b border-[var(--border)] flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {path.map((node, i) => (
        <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
          {i > 0 && <ChevronRight size={9} className="text-[var(--fg-faint)]" />}
          <button onClick={() => onGoTo(i)}
            className={clsx('flex items-center text-[11px] px-1 py-0.5 rounded border-0 bg-transparent cursor-pointer transition-colors',
              i === path.length - 1 ? 'text-[var(--fg)] font-medium' : 'text-[var(--fg-faint)] hover:text-[var(--fg)]')}>
            {i === 0 ? <Home size={10} /> : node.name}
          </button>
        </span>
      ))}
    </div>
  )
}

// ── List view (navigable) ────────────────────────────────────────────────────
function ListView({ root }: { root: VNode }) {
  const [path, setPath] = useState<VNode[]>([root])
  useEffect(() => { setPath([root]) }, [root.name])
  const current = path[path.length - 1]
  const items   = current.children ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Breadcrumb path={path} onGoTo={i => setPath(p => p.slice(0, i + 1))} />
      {path.length > 1 && (
        <button onClick={() => setPath(p => p.slice(0, -1))}
          className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors border-0 border-b border-[var(--border)] bg-transparent cursor-pointer text-left flex-shrink-0">
          <ArrowLeft size={11} /> <span>.. (back)</span>
        </button>
      )}
      <div className="flex-1 overflow-y-auto py-0.5" style={{ scrollbarWidth: 'thin' }}>
        {items.length === 0 && <div className="px-4 py-3 text-[11px] text-[var(--fg-faint)] italic">Empty directory</div>}
        {items.map((node, i) => (
          <button key={i} onClick={() => node.type === 'dir' && setPath(p => [...p, node])}
            className={clsx('w-full flex items-center gap-2 px-3 py-[5px] text-left border-0 transition-colors hover:bg-[var(--hover)]',
              node.type === 'dir' ? 'cursor-pointer' : 'cursor-default',
              node.virtual ? 'opacity-60' : '')}>
            {node.type === 'dir' ? <Folder size={13} className="flex-shrink-0 text-[var(--fg-muted)]" /> : <VIcon node={node} />}
            <span className={clsx('flex-1 text-[12px] truncate', node.type === 'dir' ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)]')}>{node.name}</span>
            {node.type === 'dir' && <span className="text-[10px] text-[var(--fg-faint)] flex-shrink-0 flex items-center gap-1">{countFiles(node)} <ChevronRight size={9} /></span>}
            {node.virtual && <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded flex-shrink-0">gen</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Cards view (navigable) ───────────────────────────────────────────────────
function CardsView({ root }: { root: VNode }) {
  const [path, setPath] = useState<VNode[]>([root])
  useEffect(() => { setPath([root]) }, [root.name])
  const current = path[path.length - 1]
  const dirs    = (current.children ?? []).filter(n => n.type === 'dir')
  const files   = (current.children ?? []).filter(n => n.type === 'file')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Breadcrumb path={path} onGoTo={i => setPath(p => p.slice(0, i + 1))} />
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3" style={{ scrollbarWidth: 'thin' }}>
        {dirs.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
            {dirs.map((d, i) => (
              <button key={i} onClick={() => setPath(p => [...p, d])}
                className={clsx('flex flex-col gap-1.5 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--fg-faint)] transition-colors text-left cursor-pointer', d.virtual ? 'opacity-60' : '')}>
                <Folder size={20} className="text-[var(--fg-muted)]" />
                <span className="text-[11px] font-medium text-[var(--fg)] truncate w-full">{d.name}</span>
                <span className="text-[10px] text-[var(--fg-faint)]">{countFiles(d)} files{d.virtual && <span className="ml-1 text-[9px] bg-[var(--surface-3)] px-1 rounded">gen</span>}</span>
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] px-1 mb-1">Files</p>
            {files.map((f, i) => (
              <div key={i} className={clsx('flex items-center gap-2 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface-1)]', f.virtual ? 'opacity-60' : '')}>
                <VIcon node={f} />
                <span className="text-[12px] text-[var(--fg-muted)] flex-1 truncate">{f.name}</span>
                {f.virtual && <span className="text-[9px] font-mono text-[var(--fg-faint)] bg-[var(--surface-3)] px-1 rounded">gen</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Log panel ────────────────────────────────────────────────────────────────
function LogPanel({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [lines])
  return (
    <div ref={ref} className="border-t border-[var(--border)] bg-[var(--surface-2)] overflow-y-auto flex-shrink-0 font-mono" style={{ height: 110, scrollbarWidth: 'thin' }}>
      {lines.map(l => (
        <div key={l.id} className={clsx('px-3 py-0.5 text-[11px] leading-5 whitespace-pre-wrap', l.kind === 'err' ? 'text-red-400' : l.kind === 'sys' ? 'text-[var(--fg-faint)] italic' : 'text-[var(--fg-muted)]')}>{l.text}</div>
      ))}
      {lines.length === 0 && <div className="px-3 py-2 text-[11px] text-[var(--fg-faint)] italic">Waiting…</div>}
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function ExportWorkstation() {
  const { projectName, projectPath, board, tree, settings, setScreen, setSettingsTab } = useStore()
  const [format, setFormat] = useState<ExportFormat>('zip')
  const [logs,   setLogs  ] = useState<LogLine[]>([])
  const [status, setStatus] = useState<JobStatus>('idle')

  const fileView = settings.exportFileView ?? 'list'
  const outDir   = settings.exportOutDir   ?? ''
  const version  = settings.exportVersion  ?? '1.0.0'
  const fmt      = FORMATS.find(f => f.id === format)!
  const noProject = !projectPath

  const push = useCallback((text: string, kind: LogLine['kind'] = 'out') => setLogs(p => [...p, mkLine(text, kind)]), [])

  const previewRoot = buildTree(format, tree, projectName, board, version)

  const run = useCallback(async () => {
    if (!projectPath) return
    setStatus('running'); setLogs([])
    push(`Starting ${fmt.label} export…`, 'sys')
    try {
      const tsuki = (settings.tsukiPath?.trim() || 'tsuki').replace(/^"|"$/g, '')
      const resolvedOut = outDir || `${projectPath}/export`
      push('Building firmware…', 'sys')
      const build = await spawnProcess(tsuki, ['build', '--compile', '--board', board], projectPath, (l, e) => push(l, e ? 'err' : 'out'))
      await build.done
      push(`\nPackaging → ${resolvedOut}`, 'sys')
      const exp = await spawnProcess(tsuki, ['export', format, '--out', resolvedOut], projectPath, (l, e) => push(l, e ? 'err' : 'out'))
      await exp.done
      push(`\n✔ Export complete`, 'sys')
      setStatus('done')
    } catch (e) { push(`✖ ${e}`, 'err'); setStatus('error') }
  }, [projectPath, format, outDir, board, settings.tsukiPath, fmt.label, push])

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-[var(--surface)]">
      {/* Format tabs */}
      <div className="flex items-center gap-0 border-b border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0 px-1 pt-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {FORMATS.map(f => {
          const active = format === f.id
          return (
            <button key={f.id} onClick={() => { setFormat(f.id); setStatus('idle'); setLogs([]) }}
              className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-t text-[12px] font-medium transition-colors border-0 cursor-pointer flex-shrink-0 relative', active ? 'bg-[var(--surface)] text-[var(--fg)]' : 'text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)]')}>
              <f.Icon size={12} style={{ color: active ? f.accent : undefined }} />
              <span>{f.label}</span>
              {active && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t" style={{ background: f.accent }} />}
            </button>
          )
        })}
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Preview */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 border-r border-[var(--border)]">
          <div className="h-7 flex items-center px-3 gap-2 border-b border-[var(--border)] bg-[var(--surface-1)] flex-shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-faint)] flex-1">Preview</span>
            <div className="flex items-center gap-px">
              {(['list', 'cards'] as const).map(v => (
                <button key={v} onClick={() => useStore.getState().updateSetting('exportFileView', v)}
                  className={clsx('w-6 h-6 flex items-center justify-center border border-[var(--border)] transition-colors cursor-pointer', v === 'list' ? 'rounded-l border-r-0' : 'rounded-r', fileView === v ? 'bg-[var(--surface-3)] text-[var(--fg)]' : 'bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)]')} title={v}>
                  {v === 'list' ? <List size={11} /> : <LayoutGrid size={11} />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {noProject
              ? <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--fg-faint)]"><Package size={28} className="opacity-30" /><p className="text-sm text-[var(--fg-muted)]">No project open</p></div>
              : fileView === 'cards' ? <CardsView root={previewRoot} /> : <ListView root={previewRoot} />
            }
          </div>
          {!noProject && (
            <div className="px-3 py-1.5 border-t border-[var(--border)] flex-shrink-0">
              <span className="text-[9px] text-[var(--fg-faint)]"><span className="font-mono bg-[var(--surface-3)] px-1 rounded mr-1">gen</span>generated on export</span>
            </div>
          )}
        </div>

        {/* Action panel */}
        <div className="w-48 flex-shrink-0 flex flex-col gap-3 p-3 bg-[var(--surface-1)]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: fmt.accent + '18', border: `1px solid ${fmt.accent}33` }}>
              <fmt.Icon size={14} style={{ color: fmt.accent }} />
            </div>
            <span className="text-[13px] font-semibold text-[var(--fg)]">{fmt.label}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--fg-faint)] uppercase tracking-wide font-semibold">Output</span>
            <div className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[11px] font-mono text-[var(--fg-muted)] truncate" title={outDir || 'project/export'}>
              {outDir ? outDir.split(/[\\/]/).slice(-2).join('/') : 'project/export'}
            </div>
          </div>
          {noProject && (
            <div className="flex items-start gap-1.5 px-2 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-400">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /><span>Open a project first.</span>
            </div>
          )}
          <button onClick={run} disabled={noProject || status === 'running'}
            className={clsx('flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-semibold text-[12px] transition-all border-0 cursor-pointer', noProject || status === 'running' ? 'bg-[var(--surface-3)] text-[var(--fg-faint)] cursor-not-allowed' : 'text-white')}
            style={!(noProject || status === 'running') ? { background: fmt.accent } : {}}>
            {status === 'running' ? <><Loader2 size={13} className="animate-spin" />Exporting…</> : status === 'done' ? <><Check size={13} />Done</> : status === 'error' ? <><AlertTriangle size={13} />Retry</> : <><Play size={13} />Export</>}
          </button>
          <div className="flex-1" />
          <button onClick={() => { setSettingsTab('export'); setScreen('settings') }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[var(--border)] text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent w-full">
            <Settings2 size={12} /><span>Export settings</span><ChevronRight size={10} className="ml-auto" />
          </button>
          <div className="flex flex-col gap-0.5 text-[10px] font-mono text-[var(--fg-faint)] border-t border-[var(--border)] pt-2">
            <span className="truncate flex items-center gap-1"><Package size={9} />{projectName || '(none)'}</span>
            <span className="truncate flex items-center gap-1"><Cpu size={9} />{board || '—'}</span>
          </div>
        </div>
      </div>

      {status !== 'idle' && <LogPanel lines={logs} />}
    </div>
  )
}