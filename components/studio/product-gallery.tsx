'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

/**
 * The customer's view of a product's photographs — the cover, the strip under it, and the full-size
 * overlay a tap opens.
 *
 * This is the ONLY client component on the public page, and it is one deliberately: the page itself
 * stays a server component so the token lookup and the "never render staff fields" rule cannot be
 * moved into the browser. It receives finished URLs and a name, nothing else — no ids, no tenant,
 * no prices, nothing a reader could walk back to another product.
 *
 * The audience is someone standing in a showroom holding a phone, so: real 44px targets, swipe as
 * well as arrows, and a body-scroll lock while the overlay is up (without it, iOS Safari scrolls the
 * page behind the image and the overlay drifts off-centre).
 */
export function ProductGallery({ photos, name }: { photos: string[]; name: string }) {
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const touchX = useRef<number | null>(null)
  const count = photos.length

  const go = useCallback((next: number) => setI(((next % count) + count) % count), [count])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      else if (e.key === 'ArrowRight') go(i + 1)
      else if (e.key === 'ArrowLeft') go(i - 1)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, i, go])

  if (count === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => { setI(0); setOpen(true) }}
        aria-label={`View ${name} larger`}
        className="mb-3 block w-full cursor-zoom-in overflow-hidden rounded-2xl bg-neutral-100"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[0]} alt={name} className="aspect-square w-full object-cover" />
      </button>

      {count > 1 && (
        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {photos.map((url, n) => (
            <button
              key={n}
              type="button"
              onClick={() => { setI(n); setOpen(true) }}
              aria-label={`View photo ${n + 1} of ${count}`}
              className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${name} — photo ${i + 1} of ${count}`}
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={() => setOpen(false)}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            const start = touchX.current
            touchX.current = null
            if (start == null || count < 2) return
            const dx = e.changedTouches[0].clientX - start
            if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1)
          }}
        >
          <div className="flex justify-end p-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-2 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[i]}
              alt={`${name} — photo ${i + 1}`}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain"
            />
          </div>

          {count > 1 && (
            <div className="flex items-center justify-center gap-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-white/90">
              <button type="button" aria-label="Previous photo"
                      onClick={(e) => { e.stopPropagation(); go(i - 1) }}
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <span className="text-sm tabular-nums">{i + 1} / {count}</span>
              <button type="button" aria-label="Next photo"
                      onClick={(e) => { e.stopPropagation(); go(i + 1) }}
                      className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
