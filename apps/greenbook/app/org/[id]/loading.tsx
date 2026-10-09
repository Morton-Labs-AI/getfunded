export default function OrgLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-10">
      <div className="skeleton h-3 w-40" />
      <div className="skeleton mt-3 h-8 w-[420px]" />
      <div className="mt-3 flex gap-2">
        <div className="skeleton h-6 w-28" />
        <div className="skeleton h-6 w-36" />
      </div>
      <div className="mt-5 h-[2px] w-full bg-border-1" />
      <div className="mt-6 flex gap-8">
        <div className="skeleton h-12 w-32" />
        <div className="skeleton h-12 w-32" />
        <div className="skeleton h-12 w-44" />
      </div>
      {/* the ledger's ruling exists before its entries */}
      <div className="mt-10 overflow-hidden rounded-[10px] border border-border-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex justify-between gap-6 border-b border-border-1 px-4 py-3 last:border-0">
            <div className="skeleton h-3.5" style={{ width: `${[60, 85, 40, 70, 55, 75][i]}%` }} />
            <div className="skeleton h-3.5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
