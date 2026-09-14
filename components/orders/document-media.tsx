'use client'

import { useState } from 'react'

// The customer's video and certificate links, with what to say when they fail.
//
// A <video> that cannot load renders a black box and says nothing; a certificate link that 404s
// lands on a bare page. Both happen for ordinary reasons — a file re-uploaded, a link opened on a
// train — and the customer must be told what to do, in words, without a database detail in sight.

export function DocumentVideo({ src, fileName, single }: { src: string; fileName: string; single: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={`${single ? 'max-h-80' : 'h-40'} flex w-full items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-center text-sm text-neutral-600 print:hidden`}>
        This video could not be played right now. Try reloading the page; if it still will not play, ask us and we will send it again.
      </div>
    )
  }
  return (
    <video
      src={src}
      controls
      playsInline
      // No autoplay and no loop: this is a document, and a document that starts moving on open is
      // an advertisement.
      preload="metadata"
      onError={() => setFailed(true)}
      aria-label={fileName}
      className={single
        ? 'max-h-80 w-full rounded-lg border border-neutral-200 bg-black object-contain print:hidden'
        : 'h-40 w-full rounded-lg border border-neutral-200 bg-black object-cover print:hidden'}
    />
  )
}
