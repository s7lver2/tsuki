'use client'

/**
 * ExeWarningModal — REMOVED
 *
 * This component previously intercepted commands whose binary ended in .exe
 * and asked the user to copy-paste the command manually.  That UX was broken:
 * Tauri/Rust can spawn .exe files directly via the sidecar mechanism, and the
 * dialog added friction without solving anything.
 *
 * The component is kept as a no-op export so existing imports don't break.
 * guardExe() in consumers should be updated to call action() unconditionally.
 */

interface Props {
  command: string
  onCancel: () => void
  onTryAnyway: () => void
}

/** @deprecated No longer used. Remove call sites. */
export default function ExeWarningModal(_props: Props) {
  return null
}