import { PERSONAS, assetsFor, type Breakpoint, type PersonaKey } from '@/lib/persona'

// THE ONE FACE, AT AVATAR SIZE.
//
// Same rule as the dashboard: an employee is the robot, not a stock headshot of the voice that was
// picked for them. A conversation list has dozens of rows, so this is a CSS crop of the still rather
// than a canvas — the canvas is the right answer for one hero and the wrong one for fifty rows.
//
// The crop is computed from the SAME dome the scan is drawn around: `scan.x/y` are fractions of the
// source, `scan.r` a fraction of its WIDTH. Nothing here is a hand-tuned background-position, so a
// new asset with a different dome crops correctly without anybody re-measuring it by eye.

export function RobotAvatar({
  size = 38,
  persona = 'rudi',
  breakpoint = 'mobile',
  zoom = 1.75,
  className,
}: {
  size?: number
  persona?: PersonaKey
  breakpoint?: Breakpoint
  /** How much of the frame the dome fills. 1 = the dome exactly; higher shows more of the housing. */
  zoom?: number
  className?: string
}) {
  const p = PERSONAS[persona]
  const a = assetsFor(p, breakpoint)
  const dome = a.scan

  // No dome (Miles is a photograph, not a machine) — fall back to the plain cover crop his portrait
  // was always shown with rather than inventing a focal point.
  if (!dome) {
    return (
      <span
        className={className}
        style={{ width: size, height: size, borderRadius: '50%', display: 'block',
          background: `${p.ground} center/cover no-repeat url(${a.still || p.avatar})` }}
        aria-hidden
      />
    )
  }

  // The slice of the source that should fill the box, as a fraction of image width.
  const span = Math.min(1, 2 * dome.r * zoom)
  const bgW = size / span
  const bgH = bgW * (a.height / a.width)
  // Put the dome's centre at the centre of the box.
  const left = -(dome.x * bgW - size / 2)
  const top = -(dome.y * bgH - size / 2)

  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: '50%', display: 'block', flex: 'none',
        background: `${p.ground} no-repeat url(${a.still})`,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${left}px ${top}px`,
      }}
      aria-hidden
    />
  )
}
