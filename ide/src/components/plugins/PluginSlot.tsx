'use client'
/**
 * tsuki-ide :: PluginSlot + hooks
 * Renders plugin contributions by slot, and exports data hooks for each slot type.
 */

import { useEffect, useRef } from 'react'
import type { PluginSlotId } from '@/lib/pluginLoader'
import { getSlotContributions } from '@/lib/pluginLoader'
import { usePlugins } from '@/lib/usePlugins'

// ── Shared: mount DOM node once on first activation ───────────────────────────

function useMountOnce(
  ref: React.RefObject<HTMLDivElement>,
  render: () => HTMLElement,
  id: string,
  active = true,
) {
  const mounted = useRef(false)
  useEffect(() => {
    if (!active || !ref.current || mounted.current) return
    try { ref.current.appendChild(render()); mounted.current = true }
    catch (e) { console.warn(`[plugin] render error (${id}):`, e) }
  }, [active]) // eslint-disable-line
}

// ── Components ────────────────────────────────────────────────────────────────

export function PluginSidebarTab({ active, renderContent, tabId, pluginId, label, icon, onActivate }: {
  pluginId: string; tabId: string; label: string; icon?: string
  active: boolean; onActivate: () => void; renderContent: () => HTMLElement
}) {
  const ref = useRef<HTMLDivElement>(null)
  useMountOnce(ref, renderContent, tabId, active)
  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div ref={ref} style={{ flex: 1 }} />
    </div>
  )
}

export function PluginBottomTabContent({ tabId, renderContent }: { tabId: string; renderContent: () => HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try { ref.current.appendChild(renderContent()) }
    catch (e) { console.warn(`[plugin] bottom tab ${tabId} render error:`, e) }
    return () => { if (ref.current) ref.current.innerHTML = '' }
  }, []) // eslint-disable-line
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
}

export function PluginWorkstation({ workstationId, active, renderContent }: {
  workstationId: string; active: boolean; renderContent: () => HTMLElement
}) {
  const ref = useRef<HTMLDivElement>(null)
  useMountOnce(ref, renderContent, workstationId, active)
  return (
    <div style={{ display: active ? 'flex' : 'none', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={ref} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}

export function PluginStatusBarItem({ itemId, renderContent }: { itemId: string; renderContent: () => HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try { ref.current.appendChild(renderContent()) }
    catch (e) { console.warn(`[plugin] status bar ${itemId} render error:`, e) }
    return () => { if (ref.current) ref.current.innerHTML = '' }
  }, []) // eslint-disable-line
  return <div ref={ref} style={{ display: 'flex', alignItems: 'center' }} />
}

export function PluginSettingsPanel({ panelId, label, renderContent }: { panelId: string; label: string; renderContent: () => HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try { ref.current.appendChild(renderContent()) }
    catch (e) { console.warn(`[plugin] settings ${panelId} render error:`, e) }
    return () => { if (ref.current) ref.current.innerHTML = '' }
  }, []) // eslint-disable-line
  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>{label}</h3>
      <div ref={ref} />
    </div>
  )
}

// ── Main slot (toolbar-action renders inline) ─────────────────────────────────

export default function PluginSlot({ slot, className }: { slot: PluginSlotId; className?: string }) {
  usePlugins()
  const contributions = getSlotContributions(slot)
  if (contributions.length === 0) return null

  if (slot === 'toolbar-action') {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {contributions.map(({ plugin, contribution }) => (
          <button
            key={`${plugin.meta.id}-${contribution.id}`}
            title={contribution.label}
            onClick={contribution.onClick}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 8px', color: 'var(--fg-muted)', fontSize: 12,
              borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.08))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {contribution.icon && <span style={{ fontSize: 14 }}>{contribution.icon}</span>}
            <span>{contribution.label}</span>
          </button>
        ))}
      </div>
    )
  }
  return null
}

// ── Data hooks ────────────────────────────────────────────────────────────────

export function usePluginSidebarTabs() {
  usePlugins()
  return getSlotContributions('sidebar-tab').map(({ plugin, contribution }) => ({
    id: `plugin:${plugin.meta.id}:${contribution.id}`,
    label: contribution.label, icon: contribution.icon,
    renderContent: contribution.render, pluginId: plugin.meta.id,
  }))
}

export function usePluginBottomTabs() {
  usePlugins()
  return getSlotContributions('bottom-tab').map(({ plugin, contribution }) => ({
    id: `plugin:${plugin.meta.id}:${contribution.id}`,
    label: contribution.label, renderContent: contribution.render,
  }))
}

export function usePluginWorkstations() {
  usePlugins()
  return getSlotContributions('workstation').map(({ plugin, contribution }) => ({
    id: `plugin:${plugin.meta.id}:${contribution.id}`,
    label: contribution.label, icon: contribution.icon,
    shortcut: contribution.shortcut, renderContent: contribution.render,
    pluginId: plugin.meta.id,
  }))
}

export function usePluginStatusBarItems(position: 'left' | 'right') {
  usePlugins()
  return getSlotContributions('status-bar')
    .filter(({ contribution }) => contribution.position === position)
    .map(({ plugin, contribution }) => ({
      id: `plugin:${plugin.meta.id}:${contribution.id}`,
      renderContent: contribution.render,
    }))
}

export function usePluginSettingsPanels() {
  usePlugins()
  return getSlotContributions('settings-panel').map(({ plugin, contribution }) => ({
    id: `plugin:${plugin.meta.id}:${contribution.id}`,
    label: contribution.label, renderContent: contribution.render,
  }))
}

export function usePluginEditorExtensions() {
  usePlugins()
  return getSlotContributions('editor-extension').map(({ contribution }) => contribution)
}