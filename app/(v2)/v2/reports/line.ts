import type { RudiSegment } from '../rudi-line'

export interface ReportsLineInput {
  templates: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// Reports has no figures of its own — it is a menu, not a measurement. So the line says what the
// screen is FOR in the owner's terms rather than inventing a statistic to open with, and nothing is
// accented: there is no action here that needs a person, and spending the gradient on a heading would
// spend it on nothing.
export function reportsLine({ templates }: ReportsLineInput): RudiSegment[] {
  return [{
    text: `${templates} ${plural(templates, 'report', 'reports')} you can build from what Rudi has already recorded, or export as a file.`,
  }]
}
