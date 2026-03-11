'use client'
import { useStore, FileNode, TabItem } from '@/lib/store'
import { IconBtn } from '@/components/shared/primitives'
import {
  FilePlus, FolderPlus, RotateCcw, ChevronRight, File, Folder,
  Pencil, Trash2, Copy, X, ChevronDown,
} from 'lucide-react'
import { useState, useRef, useMemo } from 'react'
import { showContextMenu } from '@/components/shared/ContextMenu'
import { getIconPack } from '@/lib/iconPacks'

// ── Open editors tree ─────────────────────────────────────────────────────────
// Groups open tabs by their parent folder in the real file tree

interface OpenEditorGroup {
  dirName: string   // display name of the folder ('src', 'root', etc.)
  dirId:   string
  tabs:    TabItem[]
}

function buildOpenEditorGroups(
  openTabs: TabItem[],
  tree: FileNode[],
): OpenEditorGroup[] {
  if (!openTabs.length) return []

  const groups = new Map<string, OpenEditorGroup>()

  for (const tab of openTabs) {
    // Find parent dir in the tree
    const node   = tree.find(n => n.id === tab.fileId)
    const parent = node
      ? tree.find(p => p.type === 'dir' && p.children?.includes(tab.fileId))
      : null
    const dirId   = parent?.id   ?? 'root'
    const dirName = parent?.name ?? 'root'

    if (!groups.has(dirId)) groups.set(dirId, { dirId, dirName, tabs: [] })
    groups.get(dirId)!.tabs.push(tab)
  }

  return Array.from(groups.values())
}

// ── Open Editors panel with folder tree ───────────────────────────────────────

function OpenEditorsPanel() {
  const { openTabs, activeTabIdx, openFile, closeTab, tree, settings } = useStore()
  const [collapsed, setCollapsed]           = useState(false)
  const [collapsedDirs, setCollapsedDirs]   = useState<Set<string>>(new Set())

  const pack = getIconPack(settings.iconPack ?? 'minimal')
  const groups = useMemo(() => buildOpenEditorGroups(openTabs, tree), [openTabs, tree])

  if (!openTabs.length) return null

  function toggleDir(dirId: string) {
    setCollapsedDirs(s => {
      const next = new Set(s)
      next.has(dirId) ? next.delete(dirId) : next.add(dirId)
      return next
    })
  }

  return (
    <div className="border-b border-[var(--border)] flex-shrink-0">

      {/* Section header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full h-7 flex items-center gap-1 px-2 text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer transition-colors group"
      >
        <ChevronDown
          size={10}
          className={`flex-shrink-0 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-widest flex-1 text-left select-none">
          Open Editors
        </span>
        <span className="text-[10px] font-mono text-[var(--fg-faint)] select-none mr-1">{openTabs.length}</span>
        {/* Close all button */}
        {!collapsed && (
          <button
            title="Close all"
            onClick={e => { e.stopPropagation(); for (let i = openTabs.length - 1; i >= 0; i--) closeTab(i) }}
            className="w-4 h-4 flex items-center justify-center rounded border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--err)] cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={9} />
          </button>
        )}
      </button>

      {/* Grouped tab tree */}
      {!collapsed && (
        <div className="pb-1.5">
          {groups.map(group => {
            const isMultiGroup = groups.length > 1
            const isDirCollapsed = collapsedDirs.has(group.dirId)

            return (
              <div key={group.dirId}>
                {/* Folder row — only shown if more than one group */}
                {isMultiGroup && (
                  <button
                    onClick={() => toggleDir(group.dirId)}
                    className="w-full flex items-center gap-1.5 h-[20px] px-2 text-[var(--fg-faint)] hover:text-[var(--fg-muted)] border-0 bg-transparent cursor-pointer transition-colors"
                  >
                    <ChevronRight
                      size={9}
                      className={`flex-shrink-0 transition-transform duration-100 ${isDirCollapsed ? '' : 'rotate-90'}`}
                    />
                    {pack.folderIcon(!isDirCollapsed)}
                    <span className="text-[10px] font-medium truncate">{group.dirName}</span>
                  </button>
                )}

                {/* File rows */}
                {!isDirCollapsed && group.tabs.map((tab) => {
                  const idx      = openTabs.findIndex(t => t.fileId === tab.fileId)
                  const isActive = idx === activeTabIdx
                  const indent   = isMultiGroup ? 20 : 8

                  return (
                    <div
                      key={tab.fileId}
                      onClick={() => openFile(tab.fileId)}
                      className={`
                        group/tab flex items-center gap-1.5 h-[22px] cursor-pointer relative transition-colors
                        ${isActive
                          ? 'bg-[var(--active)] text-[var(--fg)]'
                          : 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
                        }
                      `}
                      style={{ paddingLeft: indent, paddingRight: 4 }}
                    >
                      {/* Active indicator */}
                      {isActive && (
                        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--fg)] rounded-r" />
                      )}

                      {/* Connector line for tree feel */}
                      {isMultiGroup && (
                        <span
                          className="absolute pointer-events-none"
                          style={{
                            left: 9, top: 0, bottom: 0, width: 1,
                            background: 'var(--border-subtle)',
                          }}
                        />
                      )}

                      {/* Modified dot */}
                      {tab.modified
                        ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--fg-muted)] flex-shrink-0 z-10" />
                        : <span className="w-1.5 flex-shrink-0" />
                      }

                      {/* Icon */}
                      <span className="flex-shrink-0 z-10">{pack.fileIcon(tab.ext)}</span>

                      {/* Name */}
                      <span className="flex-1 truncate text-xs z-10">{tab.name}</span>

                      {/* Close button */}
                      <button
                        onClick={e => { e.stopPropagation(); closeTab(idx) }}
                        className="w-4 h-4 flex items-center justify-center rounded border-0 bg-transparent text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--surface-4)] cursor-pointer opacity-0 group-hover/tab:opacity-100 transition-opacity flex-shrink-0 z-10"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── File tree node ─────────────────────────────────────────────────────────────

function TreeNode({ nodeId, depth, activeFileId, openTabFileIds, onOpen }: {
  nodeId: string
  depth: number
  activeFileId: string
  openTabFileIds: Set<string>
  onOpen: (id: string) => void
}) {
  const { tree, renameNode, deleteNode, settings } = useStore()
  const node = tree.find(n => n.id === nodeId)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [hovered, setHovered] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  const pack = getIconPack(settings.iconPack ?? 'minimal')

  if (!node) return null
  const n = node
  const isActive = n.type === 'file' && n.id === activeFileId
  const isInTab  = n.type === 'file' && openTabFileIds.has(n.id)
  const isDir    = n.type === 'dir'
  const pad      = 8 + depth * 14

  function toggle() {
    if (renaming) return
    if (isDir) {
      useStore.setState(s => ({
        tree: s.tree.map(nd => nd.id === nodeId ? { ...nd, open: !nd.open } : nd)
      }))
    } else {
      onOpen(n.id)
    }
  }

  async function confirmRename() {
    if (renameVal.trim() && renameVal !== n.name) await renameNode(nodeId, renameVal.trim())
    setRenaming(false)
  }

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ paddingLeft: pad }}
        className={`w-full flex items-center gap-1.5 h-[22px] cursor-pointer relative group
          ${isActive
            ? 'bg-[var(--active)] text-[var(--fg)]'
            : 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
          }`}
        onClick={toggle}
        onContextMenu={e => showContextMenu(e, [
          ...(!isDir ? [{ label: 'Open', icon: <File size={10} />, action: () => onOpen(n.id) }] : []),
          {
            label: 'Rename', icon: <Pencil size={10} />, shortcut: 'F2',
            disabled: n.id === 'root',
            action: () => { setRenameVal(n.name); setRenaming(true); setTimeout(() => renameRef.current?.select(), 10) },
          },
          { label: 'Copy name', icon: <Copy size={10} />, action: () => navigator.clipboard.writeText(n.name).catch(() => {}) },
          { label: 'Copy path', icon: <Copy size={10} />, action: () => navigator.clipboard.writeText(n.path ?? n.name).catch(() => {}) },
          {
            label: 'Delete', icon: <Trash2 size={10} />, danger: true, sep: true,
            disabled: ['root','src','build','manifest','gitignore'].includes(n.id),
            action: () => deleteNode(n.id),
          },
        ])}
      >
        {isActive && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--fg)]" />}

        {isDir ? (
          <ChevronRight size={10}
            className={`flex-shrink-0 transition-transform text-[var(--fg-faint)] ${n.open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-[10px] flex-shrink-0" />
        )}

        {/* Icon from pack */}
        {isDir
          ? pack.folderIcon(n.open)
          : pack.fileIcon(n.ext, false)
        }

        {renaming ? (
          <input
            ref={renameRef} value={renameVal} autoFocus
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') setRenaming(false)
              e.stopPropagation()
            }}
            onBlur={confirmRename}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-[var(--surface-3)] border border-[var(--fg-muted)] rounded px-1 text-xs outline-none text-[var(--fg)] min-w-0"
          />
        ) : (
          <span className={`flex-1 truncate text-xs ${isInTab && !isActive ? 'opacity-75' : ''}`}>
            {n.name}
          </span>
        )}

        {/* Git badge */}
        {n.git && !renaming && (
          <span className={`text-[9px] font-mono font-bold flex-shrink-0 ${
            n.git === 'A' ? 'text-[var(--ok)]' :
            n.git === 'M' ? 'text-[var(--warn)]' : 'text-[var(--err)]'
          }`}>{n.git}</span>
        )}

        {/* In-tab dot */}
        {isInTab && !isActive && !renaming && (
          <span className="w-1 h-1 rounded-full bg-[var(--fg-faint)] flex-shrink-0 mr-0.5" />
        )}

        {/* Hover actions */}
        {hovered && !renaming && n.id !== 'root' && (
          <div className="flex items-center gap-0.5 mr-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {n.type === 'file' && (
              <button
                onClick={e => { e.stopPropagation(); setRenameVal(n.name); setRenaming(true); setTimeout(() => renameRef.current?.select(), 10) }}
                title="Rename"
                className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--surface-4)] border-0 bg-transparent cursor-pointer"
              >
                <Pencil size={9} />
              </button>
            )}
            {!['src','build','manifest','gitignore'].includes(n.id) && (
              <button
                onClick={e => { e.stopPropagation(); deleteNode(n.id) }}
                title="Delete"
                className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--err)] hover:bg-[var(--surface-4)] border-0 bg-transparent cursor-pointer"
              >
                <Trash2 size={9} />
              </button>
            )}
          </div>
        )}
      </div>

      {isDir && n.open && n.children?.map(childId => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1}
          activeFileId={activeFileId} openTabFileIds={openTabFileIds} onOpen={onOpen} />
      ))}
    </>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function FilesSidebar() {
  const { tree, openTabs, activeTabIdx, openFile, addFile, addFolder, refreshTree } = useStore()
  const [creatingFile, setCreatingFile]     = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [inputVal, setInputVal]             = useState('')
  const [refreshing, setRefreshing]         = useState(false)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)

  const activeFileId   = activeTabIdx >= 0 ? openTabs[activeTabIdx]?.fileId : ''
  const openTabFileIds = new Set(openTabs.map(t => t.fileId))
  const root = tree.find(n => n.id === 'root')

  async function confirmNewFile() {
    if (inputVal.trim()) await addFile(inputVal.trim())
    setCreatingFile(false); setInputVal('')
  }
  async function confirmNewFolder() {
    if (inputVal.trim()) await addFolder(inputVal.trim())
    setCreatingFolder(false); setInputVal('')
  }
  async function handleRefresh() {
    setRefreshing(true); await refreshTree(); setRefreshing(false)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Open Editors (with folder tree) ── */}
      <OpenEditorsPanel />

      {/* ── File Explorer ── */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        {/* Header */}
        <div className="h-8 flex items-center px-2 border-b border-[var(--border)] flex-shrink-0">
          <button
            onClick={() => setExplorerCollapsed(c => !c)}
            className="flex items-center gap-1 text-[var(--fg-faint)] hover:text-[var(--fg)] border-0 bg-transparent cursor-pointer transition-colors flex-1 min-w-0"
          >
            <ChevronDown
              size={10}
              className={`flex-shrink-0 transition-transform duration-150 ${explorerCollapsed ? '-rotate-90' : ''}`}
            />
            <span className="text-[10px] font-semibold uppercase tracking-widest truncate select-none">
              {root?.name ?? 'Explorer'}
            </span>
          </button>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <IconBtn tooltip="New File" onClick={() => { setCreatingFile(true); setCreatingFolder(false); setInputVal('') }}>
              <FilePlus size={12} />
            </IconBtn>
            <IconBtn tooltip="New Folder" onClick={() => { setCreatingFolder(true); setCreatingFile(false); setInputVal('') }}>
              <FolderPlus size={12} />
            </IconBtn>
            <IconBtn tooltip="Refresh" onClick={handleRefresh}>
              <RotateCcw size={11} className={refreshing ? 'animate-spin' : ''} />
            </IconBtn>
          </div>
        </div>

        {/* Tree */}
        {!explorerCollapsed && (
          <div className="flex-1 overflow-y-auto py-1">
            {root && root.children?.map(id => (
              <TreeNode
                key={id} nodeId={id} depth={0}
                activeFileId={activeFileId}
                openTabFileIds={openTabFileIds}
                onOpen={openFile}
              />
            ))}

            {(creatingFile || creatingFolder) && (
              <div className="flex items-center gap-1.5 px-3 py-1">
                {creatingFolder
                  ? <Folder size={12} className="text-[#e0c060] flex-shrink-0" />
                  : <File size={12} className="text-[var(--fg-muted)] flex-shrink-0" />
                }
                <input
                  autoFocus value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') creatingFile ? confirmNewFile() : confirmNewFolder()
                    if (e.key === 'Escape') { setCreatingFile(false); setCreatingFolder(false) }
                  }}
                  onBlur={() => { setCreatingFile(false); setCreatingFolder(false) }}
                  placeholder={creatingFile ? 'filename.go' : 'folder-name'}
                  className="flex-1 bg-[var(--surface-3)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs outline-none text-[var(--fg)]"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}