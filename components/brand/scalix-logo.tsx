// The SCALIX26 mark — a voice waveform inside a split gradient ring (cyan → blue →
// purple). Clean, scalable SVG (no marketing glow), so it stays crisp at any size and
// inherits no background. Decorative; the wordmark beside it carries the name.

const BAR_HEIGHTS = [5, 8, 12, 17, 22, 28, 22, 17, 12, 8, 5]

export function ScalixLogo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id="scalixWave" gradientUnits="userSpaceOnUse" x1="14" y1="50" x2="86" y2="50">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.5" stopColor="#5B6CF0" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>

      {/* Split ring — gaps at top and bottom, rounded ends */}
      <path d="M55.84 8.41 A42 42 0 0 1 55.84 91.59" stroke="url(#scalixWave)" strokeWidth="4" strokeLinecap="round" />
      <path d="M44.16 8.41 A42 42 0 0 0 44.16 91.59" stroke="url(#scalixWave)" strokeWidth="4" strokeLinecap="round" />

      {/* Voice waveform — symmetric, tallest in the center */}
      {BAR_HEIGHTS.map((h, i) => {
        const x = 50 + (i - 5) * 4.6
        return (
          <line
            key={i}
            x1={x}
            y1={50 - h}
            x2={x}
            y2={50 + h}
            stroke="url(#scalixWave)"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}
