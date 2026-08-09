/** Ledger skeleton for the filing page (same idiom as the org profile). */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 pb-16">
      <div className="pt-10">
        <div className="skeleton h-4 w-44 rounded-[6px]" />
        <div className="skeleton mt-3 h-8 w-[440px] rounded-[8px]" />
        <div className="skeleton mt-3 h-4 w-72 rounded-[6px]" />
      </div>
      <div className="mt-8 flex gap-8 border-b border-border-1 pb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="skeleton h-3 w-20 rounded-[5px]" />
            <div className="skeleton h-9 w-32 rounded-[8px]" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div className="skeleton h-48 rounded-[10px]" />
        <div className="skeleton h-48 rounded-[10px]" />
      </div>
      <div className="skeleton mt-8 h-64 rounded-[10px]" />
    </div>
  );
}
