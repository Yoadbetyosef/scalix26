import { ScoreboardBoard } from '@/components/command-center/scoreboard-board'

export const dynamic = 'force-dynamic'

export default function CommandCenterScoreboard() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Weekly Scoreboard</h2>
        <p className="text-sm text-subtle">Every Monday: is each engine winning or losing? Set the goal, log the actual — status and trend are computed.</p>
      </div>
      <ScoreboardBoard />
    </div>
  )
}
