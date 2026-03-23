'use client'
import { useState, useEffect, useCallback } from 'react'
import { Download, X, RefreshCw, CheckCircle, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import {
  checkForUpdate,
  installUpdate,
  type UpdateInfo,
  type UpdateProgress,
  type UpdateChannel,
} from '@/lib/ideUpdater'

// ─────────────────────────────────────────────────────────────────────────────
//  UpdateBanner
//
//  A slim notification strip that appears at the top of the IDE when a newer
//  version of tsuki-ide is available.
//
//  Lifecycle:
//    1. On mount (or when refreshPlugins is called), calls checkForUpdate().
//    2. If an update is available, shows the banner.
//    3. User clicks "Install" → shows the UpdateModal.
//    4. On success, the app restarts automatically.
//
//  Props:
//    channel — "stable" (default) or "testing"
//    onDismiss — called when the user dismisses the banner without installing
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  channel?:  UpdateChannel
  onDismiss?: () => void
}

export default function UpdateBanner({ channel = 'stable', onDismiss }: Props) {
  const [info,        setInfo]        = useState<UpdateInfo | null>(null)
  const [showModal,   setShowModal]   = useState(false)
  const [dismissed,   setDismissed]   = useState(false)

  // Check once on mount
  useEffect(() => {
    let cancelled = false
    checkForUpdate(channel).then(update => {
      if (!cancelled && update) setInfo(update)
    })
    return () => { cancelled = true }
  }, [channel])

  const dismiss = useCallback(() => {
    setDismissed(true)
    onDismiss?.()
  }, [onDismiss])

  if (!info || dismissed) return null

  return (
    <>
      {/* Banner strip */}
      <div
        style={{
          position:       'relative',
          display:        'flex',
          alignItems:     'center',
          gap:            8,
          padding:        '5px 12px',
          background:     'linear-gradient(90deg, rgba(96,165,250,0.12) 0%, rgba(74,222,128,0.1) 100%)',
          borderBottom:   '1px solid rgba(255,255,255,0.07)',
          fontSize:       11,
          color:          'var(--fg)',
          flexShrink:     0,
        }}
      >
        <Download size={12} style={{ color: '#60a5fa', flexShrink: 0 }} />

        <span style={{ flex: 1, color: 'var(--fg-muted)' }}>
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>
            tsuki-ide v{info.version}
          </span>{' '}
          is available
          {info.method === 'v2' ? ' via package registry' : ''}
          {info.notes ? ` — ${info.notes.slice(0, 80)}` : ''}
        </span>

        <button
          onClick={() => setShowModal(true)}
          style={{
            padding:      '2px 10px',
            borderRadius: 4,
            border:       '1px solid rgba(96,165,250,0.4)',
            background:   'rgba(96,165,250,0.12)',
            color:        '#60a5fa',
            fontSize:     11,
            cursor:       'pointer',
            fontWeight:   500,
          }}
        >
          Install
        </button>

        {info.releaseUrl && (
          <a
            href={info.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--fg-faint)', display: 'flex' }}
            title="View release notes"
          >
            <ExternalLink size={11} />
          </a>
        )}

        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--fg-faint)', display: 'flex', padding: 2,
          }}
        >
          <X size={11} />
        </button>
      </div>

      {/* Install modal */}
      {showModal && (
        <UpdateModal
          info={info}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  UpdateModal
// ─────────────────────────────────────────────────────────────────────────────

function UpdateModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [started,  setStarted]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Listen to Tauri progress events from the Rust side
  useEffect(() => {
    const unlisten = listen<UpdateProgress>('ide-update-progress', ({ payload }) => {
      setProgress(payload)
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  const startInstall = useCallback(async () => {
    setStarted(true)
    setError(null)
    try {
      await installUpdate(info, p => setProgress(p))
    } catch (err) {
      setError(String(err))
      setStarted(false)
    }
  }, [info])

  const isDone  = progress?.stage === 'done'
  const isError = progress?.stage === 'error' || !!error

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         10000,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget && !started) onClose() }}
    >
      <div
        style={{
          width:        440,
          maxWidth:     '92vw',
          borderRadius: 16,
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          boxShadow:    '0 32px 80px rgba(0,0,0,0.6)',
          overflow:     'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(96,165,250,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Download size={15} style={{ color: '#60a5fa' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
              Update Available
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 1 }}>
              v{info.current} → v{info.version}
              <span style={{
                marginLeft: 6,
                padding: '1px 5px',
                borderRadius: 3,
                background: info.method === 'v2' ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)',
                color:      info.method === 'v2' ? '#4ade80'               : '#fbbf24',
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {info.method === 'v2' ? 'registry' : 'legacy'}
              </span>
            </div>
          </div>
          {!started && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-faint)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          {/* Method description */}
          {!started && (
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
              {info.method === 'v2'
                ? <>The update will be downloaded from the tsuki package registry, verified with an Ed25519 signature, and installed automatically. The IDE will restart.</>
                : <>The update will be downloaded from GitHub Releases, verified, and installed. The IDE will restart.</>
              }
              {info.notes && <><br /><br /><span style={{ color: 'var(--fg)' }}>{info.notes}</span></>}
            </p>
          )}

          {/* Progress */}
          {started && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                fontSize: 12, color: isDone ? '#4ade80' : isError ? '#f87171' : 'var(--fg)',
              }}>
                {isDone    && <CheckCircle size={13} style={{ color: '#4ade80' }} />}
                {isError   && <AlertCircle size={13} style={{ color: '#f87171' }} />}
                {!isDone && !isError && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                <span>{progress?.message ?? 'Starting…'}</span>
              </div>

              {/* Progress bar */}
              {!isDone && !isError && (
                <div style={{
                  height: 3, borderRadius: 2,
                  background: 'var(--surface-2)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progress?.percent ?? 0}%`,
                    background: 'linear-gradient(90deg, #60a5fa, #4ade80)',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}

              {isError && (
                <p style={{ margin: '8px 0 0', fontSize: 11, color: '#f87171' }}>
                  {error ?? progress?.message}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px 16px',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          {!started && (
            <>
              <button
                onClick={onClose}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--fg-muted)',
                  fontSize: 12, cursor: 'pointer',
                }}
              >
                Later
              </button>
              <button
                onClick={startInstall}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  background: 'rgba(96,165,250,0.15)',
                  border: '1px solid rgba(96,165,250,0.35)',
                  color: '#60a5fa',
                  fontSize: 12, cursor: 'pointer',
                  fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <RefreshCw size={11} /> Install & Restart
              </button>
            </>
          )}
          {isError && (
            <button
              onClick={() => { setStarted(false); setError(null); setProgress(null) }}
              style={{
                padding: '6px 14px', borderRadius: 6,
                background: 'none', border: '1px solid var(--border)',
                color: 'var(--fg-muted)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}