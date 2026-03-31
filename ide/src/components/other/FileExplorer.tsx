'use client'
// ─────────────────────────────────────────────────────────────────────────────
//  FileExplorer — tsuki IDE
//
//  Two modes:
//  • sidebar (compact=false): classic tree with expand/collapse
//  • bottom panel (compact=true): navigator — click dirs to enter, breadcrumb to go back
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import type { FileNode } from '@/lib/store'
import { clsx } from 'clsx'
import { showContextMenu } from '@/components/shared/ContextMenu'
import {
  ChevronRight, ArrowLeft, Home,
  Folder, FolderOpen, File, FileCode, FileText, Binary,
  FilePlus, FolderPlus, Trash2, Container, Wrench, Package,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function NodeIcon({ node }: { node: FileNode }) {
  if (node.type === 'dir') return null
  const ext = node.ext ?? ''
  if (['go', 'cpp', 'c', 'h', 'hpp', 'cc', 'py'].includes(ext))
    return <FileCode size={13} className="flex-shrink-0 text-sky-400" />
  if (['json', 'toml', 'yaml', 'yml', 'env'].includes(ext))
    return <FileText size={13} className="flex-shrink-0 text-yellow-400" />
  if (ext === 'md')
    return <FileText size={13} className="flex-shrink-0 text-emerald-400" />
  if (['hex', 'bin', 'elf', 'uf2'].includes(ext))
    return <Binary size={13} className="flex-shrink-0 text-purple-400" />
  if (node.name === 'Dockerfile' || node.name === '.dockerignore')
    return <Container size={13} className="flex-shrink-0 text-cyan-400" />
  if (node.name.endsWith('.sh') || node.name.endsWith('.bat'))
    return <Wrench size={13} className="flex-shrink-0 text-orange-400" />
  return <File size={13} className="flex-shrink-0 text-[var(--fg-faint)]" />
}

function gitBadge(git?: FileNode['git']) {
  if (!git) return null
  const colors: Record<string, string> = { A: 'text-green-400', M: 'text-yellow-400', D: 'text-red-400' }
  return <span className={clsx('text-[10px] font-mono ml-auto flex-shrink-0', colors[git] ?? '')}>{git}</span>
}

function sortedChildren(tree: FileNode[], ids: string[]) {
  return (ids
    .map(id => tree.find(n => n.id === id))
    .filter(Boolean) as FileNode[]
  ).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tree node (sidebar mode — recursive expand/collapse)
// ─────────────────────────────────────────────────────────────────────────────

interface NodeProps {
  id: string; depth: number; selected: string | null; onSelect: (id: string) => void
  renaming: string | null; onRename: (id: string, name: string) => void; onCancelRename: () => void
}

function TreeNode({ id, depth, selected, onSelect, renaming, onRename, onCancelRename }: NodeProps) {
  const { tree, openFile, deleteNode, addFile, addFolder } = useStore()
  const node = tree.find(n => n.id === id)
  const [open, setOpen] = useState(depth === 0 || node?.open)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming === id) setTimeout(() => renameRef.current?.select(), 10)
  }, [renaming, id])

  if (!node) return null
  const sorted = sortedChildren(tree, node.type === 'dir' ? (node.children ?? []) : [])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation(); onSelect(id)
    if (node!.type === 'file') openFile(id)
    if (node!.type === 'dir')  setOpen(o => !o)
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation(); onSelect(id)
    if (node!.type === 'file') {
      showContextMenu(e, [
        { label: 'Open',       action: () => openFile(id) },
        { label: 'Rename',     action: () => onRename(id, node!.name), sep: true },
        { label: 'Copy name',  action: () => navigator.clipboard.writeText(node!.name).catch(() => {}) },
        { label: 'Copy path',  action: () => navigator.clipboard.writeText(node!.path ?? node!.name).catch(() => {}), sep: true },
        { label: 'Delete',     action: () => deleteNode(id) },
      ])
    } else {
      showContextMenu(e, [
        { label: 'New file…',  action: () => { setOpen(true); addFile('untitled', node!.path) } },
        { label: 'New folder…',action: () => { setOpen(true); addFolder('untitled') }, sep: true },
        { label: 'Rename',     action: () => onRename(id, node!.name) },
        { label: 'Copy name',  action: () => navigator.clipboard.writeText(node!.name).catch(() => {}), sep: true },
        { label: 'Delete',     action: () => deleteNode(id) },
      ])
    }
  }

  return (
    <div>
      <div
        onClick={handleClick} onContextMenu={handleContextMenu}
        className={clsx(
          'group flex items-center gap-1.5 py-[3px] pr-2 rounded cursor-pointer select-none text-[12px] transition-colors',
          selected === id ? 'bg-[var(--active)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
        )}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
      >
        {node.type === 'dir'
          ? <ChevronRight size={11} className="flex-shrink-0 text-[var(--fg-faint)] transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
          : <span className="w-[11px] flex-shrink-0" />}
        {node.type === 'dir'
          ? (open ? <FolderOpen size={13} className="flex-shrink-0 text-[var(--fg-muted)]" /> : <Folder size={13} className="flex-shrink-0 text-[var(--fg-muted)]" />)
          : <NodeIcon node={node} />}
        {renaming === id ? (
          <input ref={renameRef} defaultValue={node.name}
            className="flex-1 bg-[var(--surface)] border border-[var(--fg-faint)] rounded px-1 text-[12px] text-[var(--fg)] outline-none min-w-0"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter')  { onRename(id, (e.target as HTMLInputElement).value); return }
              if (e.key === 'Escape') { onCancelRename(); return }
            }}
            onBlur={e => onRename(id, e.target.value)}
          />
        ) : (
          <span className="flex-1 truncate leading-tight">{node.name}</span>
        )}
        {gitBadge(node.git)}
      </div>
      {node.type === 'dir' && open && sorted.map(child => (
        <TreeNode key={child.id} id={child.id} depth={depth + 1} selected={selected} onSelect={onSelect}
          renaming={renaming} onRename={onRename} onCancelRename={onCancelRename} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Navigator view (compact / bottom-panel mode)
//  Click a folder to enter it. Breadcrumb to go back. Right-click for menu.
// ─────────────────────────────────────────────────────────────────────────────

interface NavEntry { id: string; name: string }

function NavigatorView({
  selected, onSelect, renaming, onRename, onCancelRename,
}: {
  selected: string | null; onSelect: (id: string) => void
  renaming: string | null; onRename: (id: string, name: string) => void; onCancelRename: () => void
}) {
  const { tree, openFile, deleteNode, addFile, addFolder, projectName } = useStore()
  const [path, setPath] = useState<NavEntry[]>([{ id: 'root', name: projectName || 'Project' }])
  const renameRef = useRef<HTMLInputElement>(null)

  // Keep root label in sync with projectName
  useEffect(() => {
    setPath(p => [{ id: 'root', name: projectName || 'Project' }, ...p.slice(1)])
  }, [projectName])

  // Reset to root when tree is replaced (new project opened)
  useEffect(() => {
    setPath([{ id: 'root', name: projectName || 'Project' }])
  }, [tree.find(n => n.id === 'root')?.children?.join(',')]) // eslint-disable-line

  useEffect(() => {
    if (renaming) setTimeout(() => renameRef.current?.select(), 10)
  }, [renaming])

  const currentId   = path[path.length - 1].id
  const currentNode = tree.find(n => n.id === currentId)
  const items       = sortedChildren(tree, currentNode?.children ?? [])

  function enter(node: FileNode) {
    if (node.type === 'dir') {
      setPath(p => [...p, { id: node.id, name: node.name }])
      onSelect(node.id)
    } else {
      onSelect(node.id)
      openFile(node.id)
    }
  }

  function handleContextMenu(e: React.MouseEvent, node: FileNode) {
    e.preventDefault(); e.stopPropagation(); onSelect(node.id)
    if (node.type === 'file') {
      showContextMenu(e, [
        { label: 'Open',       action: () => openFile(node.id) },
        { label: 'Rename',     action: () => onRename(node.id, node.name), sep: true },
        { label: 'Copy name',  action: () => navigator.clipboard.writeText(node.name).catch(() => {}) },
        { label: 'Copy path',  action: () => navigator.clipboard.writeText(node.path ?? node.name).catch(() => {}), sep: true },
        { label: 'Delete',     action: () => deleteNode(node.id) },
      ])
    } else {
      showContextMenu(e, [
        { label: 'Open',       action: () => enter(node) },
        { label: 'New file…',  action: () => { enter(node); addFile('untitled', node.path) } },
        { label: 'New folder…',action: () => { enter(node); addFolder('untitled') }, sep: true },
        { label: 'Rename',     action: () => onRename(node.id, node.name) },
        { label: 'Copy name',  action: () => navigator.clipboard.writeText(node.name).catch(() => {}), sep: true },
        { label: 'Delete',     action: () => deleteNode(node.id) },
      ])
    }
  }

  function handleBgContext(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-nav-item]')) return
    e.preventDefault()
    showContextMenu(e, [
      { label: 'New file…',   action: () => addFile('untitled.go') },
      { label: 'New folder…', action: () => addFolder('untitled') },
    ])
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Breadcrumb */}
      <div className="flex items-center h-7 px-1 border-b border-[var(--border)] flex-shrink-0 overflow-x-auto bg-[var(--surface-2)]"
        style={{ scrollbarWidth: 'none' }}>
        {path.map((entry, i) => (
          <span key={entry.id} className="flex items-center gap-0.5 flex-shrink-0">
            {i > 0 && <ChevronRight size={9} className="text-[var(--fg-faint)]" />}
            <button
              onClick={() => setPath(p => p.slice(0, i + 1))}
              className={clsx(
                'flex items-center gap-0.5 px-1 py-0.5 rounded border-0 bg-transparent cursor-pointer transition-colors text-[11px]',
                i === path.length - 1
                  ? 'text-[var(--fg)] font-medium'
                  : 'text-[var(--fg-faint)] hover:text-[var(--fg)]',
              )}>
              {i === 0 ? <Home size={10} /> : entry.name}
            </button>
          </span>
        ))}
      </div>

      {/* Back row */}
      {path.length > 1 && (
        <button
          onClick={() => setPath(p => p.slice(0, -1))}
          className="flex items-center gap-2 px-3 py-1 text-[11px] text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors border-0 border-b border-[var(--border)] bg-transparent cursor-pointer text-left flex-shrink-0">
          <ArrowLeft size={11} /> <span className="font-mono">..</span>
        </button>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto py-0.5" style={{ scrollbarWidth: 'thin' }}
        onContextMenu={handleBgContext}>
        {items.length === 0 && (
          <div className="px-4 py-4 text-center text-[11px] text-[var(--fg-faint)] italic">Empty</div>
        )}
        {items.map(node => (
          <div key={node.id} data-nav-item="1">
            {renaming === node.id ? (
              <div className="flex items-center gap-1.5 px-3 py-[4px]">
                {node.type === 'dir' ? <Folder size={13} className="flex-shrink-0 text-[var(--fg-muted)]" /> : <NodeIcon node={node} />}
                <input ref={renameRef} defaultValue={node.name}
                  className="flex-1 bg-[var(--surface)] border border-[var(--fg-faint)] rounded px-1 text-[12px] text-[var(--fg)] outline-none min-w-0"
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { onRename(node.id, (e.target as HTMLInputElement).value); return }
                    if (e.key === 'Escape') { onCancelRename(); return }
                  }}
                  onBlur={e => onRename(node.id, e.target.value)}
                />
              </div>
            ) : (
              <button
                onClick={() => enter(node)}
                onContextMenu={e => handleContextMenu(e, node)}
                className={clsx(
                  'w-full flex items-center gap-1.5 px-3 py-[4px] text-left border-0 transition-colors text-[12px] cursor-pointer',
                  selected === node.id
                    ? 'bg-[var(--active)] text-[var(--fg)]'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]',
                )}>
                {node.type === 'dir'
                  ? <Folder size={13} className="flex-shrink-0 text-[var(--fg-muted)]" />
                  : <NodeIcon node={node} />}
                <span className="flex-1 truncate">{node.name}</span>
                {node.type === 'dir' && <ChevronRight size={10} className="flex-shrink-0 text-[var(--fg-faint)]" />}
                {gitBadge(node.git)}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  FileExplorer — root
// ─────────────────────────────────────────────────────────────────────────────

interface FileExplorerProps {
  /** compact: bottom-panel navigator mode */
  compact?: boolean
}

export default function FileExplorer({ compact = false }: FileExplorerProps) {
  const { tree, projectName, addFile, addFolder, deleteNode, renameNode, updateSetting, settings, setBottomTab, toggleSidebar } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const rootNode  = tree.find(n => n.id === 'root')
  const topLevel  = rootNode?.children ?? []

  const handleRename = useCallback(async (id: string, newName: string) => {
    const node = tree.find(n => n.id === id)
    setRenaming(null)
    if (!node || !newName.trim() || newName === node.name) return
    await renameNode(id, newName.trim())
  }, [tree, renameNode])

  function handleContainerContext(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    e.preventDefault()
    showContextMenu(e, [
      { label: 'New file…',   action: () => addFile('untitled.go') },
      { label: 'New folder…', action: () => addFolder('untitled') },
    ])
  }

  const location = settings.explorerLocation ?? 'bottom'

  function toggleLocation() {
    const next = location === 'sidebar' ? 'bottom' : 'sidebar'
    updateSetting('explorerLocation', next)
    if (next === 'bottom') setBottomTab('explorer')
    else toggleSidebar('explorer' as any)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--surface-1)]">

      {/* Toolbar */}
      <div className={clsx(
        'flex items-center gap-0.5 border-b border-[var(--border)] flex-shrink-0 bg-[var(--surface-2)]',
        compact ? 'h-7 px-1' : 'h-8 px-2',
      )}>
        <span className={clsx(
          'font-semibold uppercase tracking-widest text-[var(--fg-faint)] flex-1 truncate',
          compact ? 'text-[9px] pl-1' : 'text-[10px] pl-0.5',
        )}>
          {projectName || 'Explorer'}
        </span>

        <button title="New file" onClick={() => addFile('untitled.go')}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent">
          <FilePlus size={12} />
        </button>
        <button title="New folder" onClick={() => addFolder('untitled')}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent">
          <FolderPlus size={12} />
        </button>
        {selected && (
          <button title="Delete selected" onClick={() => { deleteNode(selected); setSelected(null) }}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-red-400 hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent">
            <Trash2 size={12} />
          </button>
        )}

        <div className="w-px h-3.5 bg-[var(--border)] mx-0.5 flex-shrink-0" />
        <button
          title={location === 'sidebar' ? 'Move to bottom panel' : 'Move to sidebar'}
          onClick={toggleLocation}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer border-0 bg-transparent">
          {location === 'sidebar'
            ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="0" y="8" width="12" height="4" rx="1" opacity="0.8"/><rect x="0" y="0" width="12" height="7" rx="1" opacity="0.3"/></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="0" y="0" width="4" height="12" rx="1" opacity="0.8"/><rect x="5" y="0" width="7" height="12" rx="1" opacity="0.3"/></svg>
          }
        </button>
      </div>

      {/* Content — navigator (compact) vs tree (sidebar) */}
      {compact ? (
        <NavigatorView
          selected={selected} onSelect={setSelected}
          renaming={renaming} onRename={handleRename} onCancelRename={() => setRenaming(null)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: 'thin' }}
          onContextMenu={handleContainerContext}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null) }}>
          {topLevel.length === 0 && (
            <div className="px-4 py-6 text-center text-[11px] text-[var(--fg-faint)]">
              <Package size={20} className="mx-auto mb-2 opacity-30" />
              No project open
            </div>
          )}
          {topLevel.map(id => (
            <div key={id} data-node="1">
              <TreeNode id={id} depth={0} selected={selected} onSelect={setSelected}
                renaming={renaming} onRename={handleRename} onCancelRename={() => setRenaming(null)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}