'use client'
import { useRef, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import { highlightByExt } from '@/lib/highlight'
import { showContextMenu } from '@/components/shared/ContextMenu'
function LineNumbers({ count, fontSize }: { count: number; fontSize: number }) {
  const lineH = Math.round(fontSize * 1.62)
  return (
    <div
      className="select-none text-right border-r border-[var(--border-subtle)] flex-shrink-0 overflow-hidden"
      style={{ width: 48, paddingTop: 12, paddingBottom: 200 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="font-mono text-[var(--fg-faint)] pr-3"
          style={{ fontSize, lineHeight: `${lineH}px` }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  )
}

// Very simple gofmt-like formatter: standardize indentation + trailing whitespace
function formatGo(code: string, tabSize: number): string {
  const tab = ' '.repeat(tabSize)
  let indent = 0
  return code.split('\n').map(raw => {
    const line = raw.trimEnd()
    if (!line) return ''
    // Decrease indent before closing braces
    const closes = (line.match(/^[\s]*[})/]/)?.[0].trim().length ?? 0)
    if (closes) indent = Math.max(0, indent - 1)
    const out = tab.repeat(indent) + line.trimStart()
    // Increase indent after opening braces
    if (line.trimEnd().endsWith('{') || line.trimEnd().endsWith('(')) indent++
    return out
  }).join('\n')
}

// Parse Go code for basic errors to populate problems
function lintGo(code: string, filename: string) {
  const problems: { id: string; severity: 'error' | 'warning' | 'info'; file: string; line: number; col: number; message: string }[] = []
  const lines = code.split('\n')
  let id = 0

  // Check for unclosed braces
  let braces = 0
  lines.forEach((line, i) => {
    for (const ch of line) {
      if (ch === '{') braces++
      if (ch === '}') braces--
    }
    // Check for common mistakes
    if (/\btrue\b|\bfalse\b/.test(line) && line.includes('==') && !line.includes('//')) {
      // Possibly ok, but flag for illustration
    }
    // Missing semicolons / commas at end of struct literals (simplified)
    if (/import\s+\(/.test(line)) return
    // Detect unused imports heuristically (just a demo)
    if (line.trim().startsWith('import "') && !line.includes('arduino') && !line.includes('fmt')) {
      const pkg = line.match(/import "([^"]+)"/)?.[1]
      if (pkg && !code.split('\n').some((l, j) => j !== i && l.includes(pkg + '.'))) {
        problems.push({ id: String(id++), severity: 'warning', file: filename, line: i + 1, col: 1, message: `Imported package "${pkg}" may be unused` })
      }
    }
  })

  if (braces !== 0) {
    problems.push({ id: String(id++), severity: 'error', file: filename, line: lines.length, col: 1, message: `Unbalanced braces (${braces > 0 ? 'missing' : 'extra'} '}')` })
  }

  // Check setup/loop are defined
  if (!code.includes('func setup()') && !code.includes('func setup() {')) {
    problems.push({ id: String(id++), severity: 'warning', file: filename, line: 1, col: 1, message: 'Missing setup() function — required for Arduino projects' })
  }
  if (!code.includes('func loop()') && !code.includes('func loop() {')) {
    problems.push({ id: String(id++), severity: 'warning', file: filename, line: 1, col: 1, message: 'Missing loop() function — required for Arduino projects' })
  }

  return problems
}

export default function CodeEditor() {
  const { openTabs, activeTabIdx, updateTabContent, saveFile, setProblems, settings } = useStore()
  const tab = activeTabIdx >= 0 ? openTabs[activeTabIdx] : null
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const lnRef = useRef<HTMLDivElement>(null)

  const content = tab?.content ?? ''
  const lines = content.split('\n')
  const lineCount = Math.max(lines.length, 1)
  const fontSize = settings.fontSize
  const lineH = Math.round(fontSize * 1.62)
  const tabSize = settings.tabSize

  // Sync textarea scroll → highlight and line numbers
  function onScroll() {
    const ta = textareaRef.current
    const hl = highlightRef.current
    const ln = lnRef.current
    if (!ta || !hl || !ln) return
    hl.style.transform = `translateY(-${ta.scrollTop}px)`
    ln.scrollTop = ta.scrollTop
  }

  // Tab key + smart indent
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget

    if (e.key === 'Tab') {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const spaces = ' '.repeat(tabSize)
      const next = ta.value.slice(0, start) + spaces + ta.value.slice(end)
      updateTabContent(activeTabIdx, next)
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + tabSize
        }
      })
      return
    }

    // Auto-close braces
    if (e.key === '{') {
      // Let it type, then check for auto indent
    }

    // Save: Ctrl+S or Cmd+S
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      let contentToSave = content

      if (tab?.ext === 'go' && settings.formatOnSave) {
        contentToSave = formatGo(contentToSave, tabSize)
        updateTabContent(activeTabIdx, contentToSave)
      }
      if (settings.trimWhitespace) {
        contentToSave = contentToSave.split('\n').map(l => l.trimEnd()).join('\n')
        updateTabContent(activeTabIdx, contentToSave)
      }
      if (tab?.ext === 'go') {
        const probs = lintGo(contentToSave, tab.name)
        setProblems(probs)
      }
      // ← Write to disk
      saveFile(activeTabIdx)
      return
    }
  }

  // Cursor position → status bar
  function onCursorMove(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget
    const before = ta.value.slice(0, ta.selectionStart)
    const ls = before.split('\n')
    useStore.setState({ _cursor: `Ln ${ls.length}, Col ${ls[ls.length - 1].length + 1}` } as any)
  }

  // Live lint as you type (debounced)
  const lintTimer = useRef<ReturnType<typeof setTimeout>>()
  function onChangeWithLint(e: React.ChangeEvent<HTMLTextAreaElement>) {
    updateTabContent(activeTabIdx, e.target.value)
    if (tab?.ext === 'go') {
      clearTimeout(lintTimer.current)
      lintTimer.current = setTimeout(() => {
        const probs = lintGo(e.target.value, tab.name)
        setProblems(probs)
      }, 1200)
    }
  }

  if (!tab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--fg-faint)]">
        <div className="w-10 h-10 rounded-lg border border-[var(--border)] flex items-center justify-center">
          <span className="font-mono font-bold text-sm">go</span>
        </div>
        <p className="text-sm">Open a file to start editing</p>
        <p className="text-xs">Select a file from the Explorer</p>
      </div>
    )
  }

  const highlighted = tab.ext
    ? highlightByExt(content, tab.ext)
    : content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const editorStyle = {
    fontSize,
    lineHeight: `${lineH}px`,
    fontFamily: 'var(--font-mono)',
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-[var(--surface)]" style={editorStyle}>
      {/* Line numbers — synced scroll */}
      <div ref={lnRef} className="overflow-hidden flex-shrink-0" style={{ width: 48 }}>
        <LineNumbers count={lineCount} fontSize={fontSize} />
      </div>

      {/* Editor scroll area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Highlighted layer */}
        <div
          ref={highlightRef}
          className="editor-highlight absolute top-0 left-0 right-0 pointer-events-none"
          style={{ ...editorStyle, willChange: 'transform' }}
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
        />

        {/* Textarea (transparent caret) */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={onChangeWithLint}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onMouseUp={onCursorMove}
          onKeyUp={onCursorMove}
          onContextMenu={e => {
            const ta = e.currentTarget
            const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd)
            showContextMenu(e, [
              {
                label: 'Cut',
                shortcut: 'Ctrl+X',
                disabled: !selected,
                action: () => {
                  if (selected) navigator.clipboard.writeText(selected).catch(() => {})
                  document.execCommand('cut')
                },
              },
              {
                label: 'Copy',
                shortcut: 'Ctrl+C',
                disabled: !selected,
                action: () => navigator.clipboard.writeText(selected).catch(() => {}),
              },
              {
                label: 'Paste',
                shortcut: 'Ctrl+V',
                action: () => {
                  navigator.clipboard.readText().then(text => {
                    const start = ta.selectionStart
                    const end   = ta.selectionEnd
                    const next  = ta.value.substring(0, start) + text + ta.value.substring(end)
                    updateTabContent(activeTabIdx, next)
                    requestAnimationFrame(() => {
                      ta.selectionStart = ta.selectionEnd = start + text.length
                    })
                  }).catch(() => {})
                },
              },
              {
                label: 'Select All',
                shortcut: 'Ctrl+A',
                sep: true,
                action: () => { ta.focus(); ta.select() },
              },
              {
                label: 'Format Document',
                shortcut: 'Ctrl+Shift+F',
                sep: true,
                disabled: tab?.ext !== 'go',
                action: () => {
                  if (tab?.ext === 'go') {
                    updateTabContent(activeTabIdx, formatGo(content, settings.tabSize ?? 2))
                  }
                },
              },
              {
                label: 'Save',
                shortcut: 'Ctrl+S',
                action: () => saveFile(activeTabIdx),
              },
            ])
          }}
          className="editor-textarea"
          style={editorStyle}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-gramm="false"
        />
      </div>

      {/* Minimap (when enabled) */}
      {settings.minimap && (
        <div
          className="w-24 flex-shrink-0 border-l border-[var(--border-subtle)] overflow-hidden opacity-40 pointer-events-none"
          style={{ fontSize: 2, lineHeight: '3px', fontFamily: 'var(--font-mono)', padding: '8px 4px' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      )}
    </div>
  )
}