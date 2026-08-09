// The streaming boundary.
//
// Without a loading.tsx there is no Suspense boundary around the page, so Next holds the ENTIRE
// response until getDashboardData and getImpactData have both resolved. Measured against the live
// database those take roughly 1–2s in total — not the reported minute, but a second or two of nothing
// before the first byte, and nothing on screen to say the page is coming.
//
// This ships immediately and is shaped like the real screen, so the layout does not jump when the
// data lands. Crucially it paints the STAGE colour rather than leaving the area bare: black is what
// the reported fault looked like, and an empty region should never be the first thing rendered.

export default function V2Loading() {
  return (
    <div className="v2-app" aria-busy="true" aria-label="Loading">
      <aside className="v2-rail">
        <div className="v2-co">
          <b style={{ opacity: 0.25 }}>&nbsp;</b>
          <span><i />Rudi · on duty</span>
        </div>
      </aside>
      {/* Painted, never bare. */}
      <main className="v2-stage v2-stage-loading" />
      <aside className="v2-side" />
    </div>
  )
}
