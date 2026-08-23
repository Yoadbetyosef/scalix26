import { notFound } from 'next/navigation'
import { rudiLine } from '../rudi-line'
import type { HomeData, ShellData } from '../data'
import { HomeClient } from '../home-client'
import { ProbeReport, type ProbeState } from './probe-report'

// A rendering probe for the /v2 hero. NOT a product screen.
//
// The measurements that gate the hero's readability — per-line caption contrast, scrim geometry —
// used to be taken on a hand-built HTML fixture kept in a scratch directory. That fixture drifted
// twice in one pass: once carrying a debug overlay left from an earlier session, once with a `sed`
// that cut into its inline <script> and silently stopped the readout cards drawing. Both times it
// produced a number that was reported as fact. A fixture nobody rebuilds is a fixture nobody can
// trust, so the fixture is now this route: the real HomeClient, the real stylesheet, served by
// `next dev`, rebuilt from committed source on every run.
//
// Stub data, not tenant data. /v2 itself needs a session and the only database is production, and
// nothing being measured here is a function of whose numbers are on the screen — the caption's line
// count is, so the stub is chosen to wrap to exactly three lines and the harness asserts that it did.
//
// Dev only. This route does not exist in a production build.

export const dynamic = 'force-dynamic'

const SHELL: ShellData = {
  businessName: 'Probe',
  // null on purpose: a phone renders `.v2-tag` ABOVE the caption and moves it down the frame. The
  // harness reads the caption's real rect rather than assuming, but the quieter frame is the one
  // worth defaulting to.
  phone: null,
}

const DATA: HomeData = {
  // Chosen to wrap to THREE lines at 390px, which is the caption the backdrop was tuned against
  // and the length a working tenant actually sees. The harness asserts the line count, so if a
  // type or copy change re-wraps this to two, the measurement aborts instead of quietly moving
  // the sample bands up the frame.
  line: rudiLine({ jobsToday: 0, newToday: 3, newHandled: 1, waiting: 1 }),
  briefing: {
    employeeName: 'Rudi', handled: 0, booked: 0, recovered: 0, coverage: null,
    attention: [], leadsAwaiting: 1, callsAnswered: 3, textsHandled: 0, appointmentsToday: 0,
  },
  railCounts: { inbox: 1, appointments: 0 },
  aiOn: true,
  rightNow: [],
  needsYou: [],
  monthLabel: 'This month',
  monthStats: [],
  tiles: [],
  groups: [],
  recent: [],
}

export default async function V2Probe({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { state } = await searchParams
  const force: ProbeState = state === 'listening' ? 'listening' : 'idle'
  return (
    <>
      <HomeClient shell={SHELL} dataPromise={Promise.resolve(DATA)} modules={[]} />
      <ProbeReport force={force} />
    </>
  )
}
