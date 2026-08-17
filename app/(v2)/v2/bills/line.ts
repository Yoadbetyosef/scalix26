import type { BillList } from '@/lib/invoices/bills-read'

// THE OPENING LINE ON /v2/bills.
//
// Same rule as every other one in /v2: it says what is true, and it says nothing rather than padding a
// zero. The accented clause is the thing to act on, and there is never more than one of them — two
// accents is no accent.
//
// The subject is always WAITING, not the total. A bill that has been applied is finished; a list that
// opens by announcing how many finished things it holds is describing itself rather than the work.

export interface Segment { text: string; accent?: boolean }

export function billsLine(list: Pick<BillList, 'waiting' | 'applied' | 'other' | 'total'>): Segment[] {
  const { waiting, applied, other, total } = list

  if (total === 0) return [{ text: 'No supplier bills yet.' }]

  const received = `${total} ${total === 1 ? 'bill' : 'bills'} received. `

  if (waiting.length > 0) {
    // "One is waiting on you" — the reference's own words, and the right ones: it names who the
    // bottleneck is. "1 pending" would not.
    const which = waiting.length === 1 ? 'One is waiting on you.' : `${waiting.length} are waiting on you.`
    return [{ text: received }, { text: which, accent: true }]
  }

  // Nothing waiting. What is left is either finished or still being read, and "still being read" is
  // the more useful thing to say because it is the one that will change on its own.
  if (other.length > 0) {
    const reading = other.filter((b) => b.status === 'reading').length
    if (reading > 0) {
      return [{ text: received }, { text: reading === 1 ? 'One is still being read.' : `${reading} are still being read.` }]
    }
    return [{ text: received }, { text: `${other.length} could not be read.`, accent: true }]
  }

  if (applied.length === total) {
    return [{ text: total === 1 ? 'One bill, applied.' : `All ${total} bills applied.` }]
  }
  return [{ text: received }, { text: 'Nothing is waiting on you.' }]
}
