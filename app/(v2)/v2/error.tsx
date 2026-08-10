'use client'

// The boundary for the streamed data.
//
// loadHomeData resolves after the shell has already rendered, so a failure arrives LATE — after the
// page looks fine. Without this the rejection would surface as a blank region or a client-side crash
// with nothing on screen to explain it, which is the same silent-failure shape this project keeps
// finding. Here it says what happened and offers the one action that helps.

export default function V2Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="v2-app">
      <main className="v2-stage v2-stage-loading" style={{ gridColumn: '1 / -1', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: '#fff', padding: 24 }}>
          <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Rudi could not load today&rsquo;s numbers.</p>
          <button type="button" onClick={reset} className="v2-talk" style={{ position: 'static', display: 'inline-flex' }}>
            <span className="v2-lab">Try again</span>
          </button>
        </div>
      </main>
    </div>
  )
}
