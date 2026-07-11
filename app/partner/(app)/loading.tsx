// Skeleton for the company operating system — calm shimmer, never a spinner.
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="animate-pulse rounded-3xl border border-hairline bg-surface px-6 py-10 text-center shadow-e1">
        <div className="mx-auto h-3 w-40 rounded bg-sunken" />
        <div className="mx-auto mt-4 h-12 w-56 rounded-xl bg-sunken" />
        <div className="mx-auto mt-5 h-3 w-72 rounded bg-sunken" />
        <div className="mx-auto mt-7 flex justify-center gap-2.5">
          <div className="h-10 w-32 rounded-full bg-sunken" />
          <div className="h-10 w-28 rounded-full bg-sunken" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-2xl border border-hairline bg-surface" />)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl border border-hairline bg-surface" />)}
      </div>
    </div>
  )
}
