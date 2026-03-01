'use client'
import { useStore, FileNode } from '@/lib/store'
import { IconBtn } from '@/components/ui/primitives'
import { FilePlus, FolderPlus, RotateCcw, ChevronRight, File, Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { useState, useRef } from 'react'

function getFileColor(ext?: string): string {
  const map: Record<string, string> = {
    go:        'text-[#6ba4e0]',
    json:      'text-[#e0b96b]',
    txt:       'text-[var(--fg-muted)]',
    gitignore: 'text-[var(--fg-faint)]',
    md:        'text-[var(--fg-muted)]',
  }
  return map[ext || ''] || 'text-[var(--fg-muted)]'
}

function FileIcon({ node }: { node: FileNode }) {
  const color = getFileColor(node.ext)
  if (node.type === 'dir') {
    return node.open
      ? <FolderOpen size={13} className="text-[var(--fg-muted)] flex-shrink-0" />
      : <Folder size={13} className="text-[var(--fg-muted)] flex-shrink-0" />
  }
  if (node.ext === 'go') {
    return <span className={`font-mono font-bold text-[10px] leading-none w-[13px] flex-shrink-0 ${color}`}>Go</span>
  }
  return <File size={13} className={`${color} flex-shrink-0`} />
}

function TreeNode({ nodeId, depth, activeFileId, onOpen }: {
  nodeId: string
  depth: number
  activeFileId: string
  onOpen: (id: string) => void
}) {
  const { tree, renameNode, deleteNode, openTabs, closeTab } = useStore()
  const node = tree.find(n => n.id === nodeId)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [hovered, setHovered] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  if (!node) return null
  // Re-assign to a non-nullable constant so closures below are type-safe
  const n = node

  const isActive = n.type === 'file' && n.id === activeFileId
  const isDir = n.type === 'dir'
  const pad = 8 + depth * 14

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

  function startRename(e: React.MouseEvent) {
    e.stopPropagation()
    setRenameVal(n.name)
    setRenaming(true)
    setTimeout(() => renameRef.current?.select(), 10)
  }

  async function confirmRename() {
    if (renameVal.trim() && renameVal !== n.name) {
      await renameNode(nodeId, renameVal.trim())
    }
    setRenaming(false)
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    deleteNode(nodeId)
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
      >
        {isActive && (
          <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--fg)]" />
        )}

        {isDir ? (
          <ChevronRight
            size={10}
            className={`flex-shrink-0 transition-transform text-[var(--fg-faint)] ${n.open ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-[10px] flex-shrink-0" />
        )}

        <FileIcon node={n} />

        {renaming ? (
          <input
            ref={renameRef}
            value={renameVal}
            autoFocus
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
          <span className="flex-1 truncate text-xs">{n.name}</span>
        )}

        {n.git && !renaming && (
          <span className={`text-2xs font-mono font-bold flex-shrink-0 ${ 
            n.git === 'A' ? 'text-[var(--ok)]' :
            n.git === 'M' ? 'text-[var(--warn)]' :
            'text-[var(--err)]'
          }`}>{n.git}</span>
        )}

        {/* Hover action buttons */}
        {hovered && !renaming && n.id !== 'root' && (
          <div className="flex items-center gap-0.5 mr-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
            {n.type === 'file' && (
              <button
                onClick={startRename}
                title="Rename"
                className="w-4 h-4 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--surface-4)] border-0 bg-transparent cursor-pointer"
              >
                <Pencil size={9} />
              </button>
            )}
            {n.id !== 'src' && n.id !== 'build' && n.id !== 'manifest' && n.id !== 'gitignore' && (
              <button
                onClick={handleDelete}
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
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} activeFileId={activeFileId} onOpen={onOpen} />
      ))}
    </>
  )
}

export default function FilesSidebar() {
  const { tree, openTabs, activeTabIdx, openFile, addFile, addFolder } = useStore()
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [inputVal, setInputVal] = useState('')

  const activeFileId = activeTabIdx >= 0 ? openTabs[activeTabIdx]?.fileId : ''
  const root = tree.find(n => n.id === 'root')

  async function confirmNewFile() {
    if (inputVal.trim()) await addFile(inputVal.trim())
    setCreatingFile(false); setInputVal('')
  }
  async function confirmNewFolder() {
    if (inputVal.trim()) await addFolder(inputVal.trim())
    setCreatingFolder(false); setInputVal('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-8 flex items-center px-3 border-b border-[var(--border)] flex-shrink-0">
        <span className="text-2xs font-semibold text-[var(--fg-faint)] uppercase tracking-widest flex-1">
          {root?.name ?? 'Explorer'}
        </span>
        <div className="flex items-center gap-0.5">
          <IconBtn tooltip="New File" onClick={() => { setCreatingFile(true); setCreatingFolder(false); setInputVal('') }}>
            <FilePlus size={12} />
          </IconBtn>
          <IconBtn tooltip="New Folder" onClick={() => { setCreatingFolder(true); setCreatingFile(false); setInputVal('') }}>
            <FolderPlus size={12} />
          </IconBtn>
          <IconBtn tooltip="Refresh" onClick={() => {}}>
            <RotateCcw size={11} />
          </IconBtn>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {root && root.children?.map(id => (
          <TreeNode key={id} nodeId={id} depth={0} activeFileId={activeFileId} onOpen={openFile} />
        ))}

        {/* Inline input for new file/folder */}
        {(creatingFile || creatingFolder) && (
          <div className="flex items-center gap-1.5 px-3 py-1">
            {creatingFolder
              ? <Folder size={12} className="text-[var(--fg-muted)]" />
              : <File size={12} className="text-[var(--fg-muted)]" />
            }
            <input
              autoFocus
              value={inputVal}
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
    </div>
  )
}