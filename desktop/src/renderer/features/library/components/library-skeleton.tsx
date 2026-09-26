/**
 * Loading placeholder for the Home workspace — one hero-shaped block and two
 * rails of cover-shaped blocks, so the layout does not jump when data lands.
 */
export function LibrarySkeleton() {
  return (
    <div className="animate-fade-in space-y-10" aria-hidden>
      <div className="flex gap-5">
        <div className="h-52 w-40 shrink-0 rounded-md bg-sunken" />
        <div className="flex flex-1 flex-col justify-center gap-3">
          <div className="h-6 w-2/3 rounded-md bg-sunken" />
          <div className="h-4 w-1/3 rounded-md bg-sunken" />
          <div className="h-0.5 w-full max-w-md rounded-full bg-sunken" />
        </div>
      </div>
      {[0, 1].map((row) => (
        <div key={row} className="space-y-3">
          <div className="h-4 w-32 rounded-md bg-sunken" />
          <div className="flex gap-4">
            {[0, 1, 2, 3, 4, 5].map((cell) => (
              <div key={cell} className="h-44 w-32 shrink-0 rounded-md bg-sunken sm:w-36" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
