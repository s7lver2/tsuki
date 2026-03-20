'use client'
import { useState, useRef } from 'react'
import { useStore, type UserProfile } from '@/lib/store'
import { Check, Plus, Trash2, User, Camera, Upload, Edit2, X } from 'lucide-react'
import { clsx } from 'clsx'

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

// ── Avatar picker ─────────────────────────────────────────────────────────────

function AvatarPicker({
  name, avatarUrl, size = 'md', onChange,
}: {
  name: string
  avatarUrl: string
  size?: 'sm' | 'md' | 'lg'
  onChange?: (url: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const sizeClass = size === 'lg' ? 'w-16 h-16 text-xl' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm'

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !onChange) return
    const reader = new FileReader()
    reader.onload = ev => { if (typeof ev.target?.result === 'string') onChange(ev.target.result) }
    reader.readAsDataURL(file)
  }

  return (
    <div className="relative flex-shrink-0">
      <div
        className={clsx(
          'rounded-full overflow-hidden border border-[var(--border)] bg-[var(--surface-3)] flex items-center justify-center font-bold text-[var(--fg-muted)]',
          sizeClass,
          onChange && 'cursor-pointer group',
        )}
        onClick={() => onChange && fileRef.current?.click()}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span>{getInitials(name)}</span>
        )}
        {onChange && (
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
            <Camera size={size === 'lg' ? 16 : 11} className="text-white" />
          </div>
        )}
      </div>
      {onChange && <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />}
    </div>
  )
}

// ── Single profile card ───────────────────────────────────────────────────────

function ProfileCard({
  profile, isActive, onSwitch, onDelete, onEdit, onSave,
}: {
  profile: UserProfile
  isActive: boolean
  onSwitch: () => void
  onDelete: () => void
  onEdit: () => void
  onSave: () => void
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
        isActive
          ? 'border-[var(--fg-muted)] bg-[var(--active)]'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--fg-faint)]',
      )}
    >
      <AvatarPicker name={profile.name} avatarUrl={profile.avatarDataUrl} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--fg)] truncate">{profile.name}</span>
          {isActive && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-400/15 text-green-400 flex-shrink-0">
              ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
          <span className="text-[10px] text-[var(--fg-faint)] font-mono">
            {profile.settings.defaultBoard ?? 'uno'}
          </span>
          <span className="text-[10px] text-[var(--fg-faint)]">·</span>
          <span className="text-[10px] text-[var(--fg-faint)] font-mono">
            {profile.settings.ideTheme ?? 'dark'}
          </span>
          <span className="text-[10px] text-[var(--fg-faint)]">·</span>
          <span className="text-[10px] text-[var(--fg-faint)]">
            {new Date(profile.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {isActive ? (
          <button
            onClick={onSave}
            title="Save current settings into this profile"
            className="px-2.5 py-1 rounded text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
          >
            Save
          </button>
        ) : (
          <button
            onClick={onSwitch}
            className="px-2.5 py-1 rounded text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
          >
            Switch
          </button>
        )}
        <button
          onClick={onEdit}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
        >
          <Edit2 size={11} />
        </button>
        <button
          onClick={onDelete}
          title="Delete profile"
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-red-400 hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer transition-colors"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Edit profile modal ────────────────────────────────────────────────────────

function EditProfileModal({
  profile, onSave, onClose,
}: {
  profile: UserProfile
  onSave: (name: string, avatarUrl: string) => void
  onClose: () => void
}) {
  const [name,   setName]   = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatarDataUrl)

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[380px] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg)]">Edit Profile</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded text-[var(--fg-faint)] hover:text-[var(--fg)] hover:bg-[var(--hover)] border-0 bg-transparent cursor-pointer">
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <AvatarPicker name={name} avatarUrl={avatar} size="lg" onChange={setAvatar} />
          <div className="flex-1">
            <label className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest block mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={32}
              autoFocus
              className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] transition-colors"
            />
          </div>
        </div>

        {avatar && (
          <button
            onClick={() => setAvatar('')}
            className="text-xs text-[var(--fg-faint)] hover:text-red-400 text-left border-0 bg-transparent cursor-pointer transition-colors"
          >
            Remove photo
          </button>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent">
            Cancel
          </button>
          <button
            onClick={() => { if (name.trim()) { onSave(name.trim(), avatar); onClose() } }}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-semibold bg-[var(--fg)] text-[var(--surface)] hover:opacity-80 transition-opacity cursor-pointer border-0 disabled:opacity-40"
          >
            <Check size={12} /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create profile form ───────────────────────────────────────────────────────

function CreateProfileForm({ onDone }: { onDone: () => void }) {
  const { createProfile } = useStore()
  const [name,   setName]   = useState('')
  const [avatar, setAvatar] = useState('')

  function handleCreate() {
    if (!name.trim()) return
    createProfile(name.trim(), avatar)
    onDone()
  }

  return (
    <div className="flex flex-col gap-4 p-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]">
      <p className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-widest">New profile</p>
      <div className="flex items-center gap-3">
        <AvatarPicker name={name} avatarUrl={avatar} size="md" onChange={setAvatar} />
        <div className="flex-1">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Profile name…"
            maxLength={32}
            autoFocus
            className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-sm text-[var(--fg)] outline-none focus:border-[var(--fg-faint)] transition-colors placeholder:text-[var(--fg-faint)]"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-sm font-semibold bg-[var(--fg)] text-[var(--surface)] hover:opacity-80 transition-opacity cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={12} /> Create
        </button>
        <button
          onClick={onDone}
          className="px-3.5 py-1.5 rounded border border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors cursor-pointer bg-transparent"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main ProfilesPanel ────────────────────────────────────────────────────────

export default function ProfilesPanel() {
  const { profiles, activeProfileId, switchProfile, deleteProfile, updateProfileField } = useStore()
  const [creating,    setCreating]    = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)

  const editingProfile = editingId ? profiles.find(p => p.id === editingId) : null

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--fg)] mb-1">Profiles</h3>
        <p className="text-xs text-[var(--fg-faint)] leading-relaxed">
          Switch between named profiles to use different settings, boards, and CLI paths — useful for multiple projects or work vs. personal setups.
        </p>
      </div>

      {/* Profile list */}
      <div className="flex flex-col gap-2">
        {profiles.length === 0 && (
          <div className="px-4 py-6 rounded-xl border border-dashed border-[var(--border)] text-center">
            <User size={24} className="text-[var(--fg-faint)] mx-auto mb-2" />
            <p className="text-sm text-[var(--fg-muted)]">No profiles yet</p>
            <p className="text-xs text-[var(--fg-faint)] mt-1">Create one to get started</p>
          </div>
        )}
        {profiles.map((profile: UserProfile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            isActive={profile.id === activeProfileId}
            onSwitch={() => { switchProfile(profile.id) }}
            onDelete={() => {
              if (profiles.length <= 1) return
              if (confirm(`Delete profile "${profile.name}"?`)) deleteProfile(profile.id)
            }}
            onEdit={() => { setEditingId(profile.id) }}
            onSave={() => {
              // Persist the current live settings into this profile snapshot
              const live = useStore.getState().settings
              const updated = useStore.getState().profiles.map(p =>
                p.id === profile.id ? { ...p, settings: { ...live } } : p
              )
              useStore.setState({ profiles: updated })
              try { localStorage.setItem('tsuki_profiles', JSON.stringify(updated)) } catch {}
            }}
          />
        ))}
      </div>

      {/* Create */}
      {creating ? (
        <CreateProfileForm onDone={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--fg-faint)] hover:bg-[var(--hover)] transition-all cursor-pointer bg-transparent"
        >
          <Plus size={13} /> New profile
        </button>
      )}

      <p className="text-xs text-[var(--fg-faint)]">
        Switching profiles applies that profile's settings immediately. Your current settings are saved to the active profile automatically.
      </p>

      {/* Edit modal */}
      {editingProfile && (
        <EditProfileModal
          profile={editingProfile}
          onSave={(name, avatarUrl) => updateProfileField(editingProfile.id, { name, avatarDataUrl: avatarUrl })}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}