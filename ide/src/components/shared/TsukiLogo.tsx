// TsukiLogo — matches the official tsuki brand (web/components/Nav.tsx)
// accent: #00e5b0, kanji 月 in black, "tsuki" in Space Grotesk bold

interface TsukiLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showText?: boolean
  className?: string
}

const SIZES = {
  xs: { box: 16, radius: 3,  kanji: 8,  gap: 5,  textSize: 11, fw: 700 },
  sm: { box: 20, radius: 4,  kanji: 11, gap: 7,  textSize: 14, fw: 700 },
  md: { box: 26, radius: 4,  kanji: 14, gap: 10, textSize: 16, fw: 700 },
  lg: { box: 36, radius: 6,  kanji: 20, gap: 10, textSize: 20, fw: 700 },
}

export default function TsukiLogo({ size = 'sm', showText = false, className = '' }: TsukiLogoProps) {
  const s = SIZES[size]
  return (
    <div className={`flex items-center flex-shrink-0 ${className}`} style={{ gap: s.gap }}>
      <div
        style={{
          width: s.box,
          height: s.box,
          background: '#00e5b0',
          borderRadius: s.radius,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: s.kanji,
            lineHeight: 1,
            color: '#000',
            fontWeight: 700,
            fontFamily: 'serif',
            userSelect: 'none',
          }}
        >
          月
        </span>
      </div>
      {showText && (
        <span
          style={{
            fontFamily: "'Space Grotesk', 'Geist', system-ui, sans-serif",
            fontSize: s.textSize,
            fontWeight: s.fw,
            letterSpacing: '-0.03em',
            color: 'var(--fg)',
            lineHeight: 1,
          }}
        >
          tsuki
        </span>
      )}
    </div>
  )
}