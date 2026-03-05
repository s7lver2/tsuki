import { BookOpen } from 'lucide-react'

export default function WipPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center select-none">
      <div className="w-12 h-12 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] flex items-center justify-center">
        <BookOpen size={22} className="text-[var(--fg-faint)]" />
      </div>
      <div>
        <div className="text-base font-semibold mb-1">{title}</div>
        <div className="text-sm text-[var(--fg-muted)]">wip</div>
      </div>
    </div>
  )
}