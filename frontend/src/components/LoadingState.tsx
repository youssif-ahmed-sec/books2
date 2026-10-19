type LoadingCardsProps = { label: string; count?: number; className?: string };

export function LoadingCards({ label, count = 3, className = "grid gap-4 md:grid-cols-2 xl:grid-cols-3" }: LoadingCardsProps) {
  return <div className={className} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, index) => <div key={index} className="app-panel space-y-4 rounded-2xl p-5" aria-hidden="true">
      <div className="flex items-center justify-between gap-4"><span className="app-skeleton h-5 w-36 max-w-[60%]" /><span className="app-skeleton h-8 w-8 rounded-xl" /></div>
      <span className="app-skeleton h-4 w-52 max-w-full" />
      <span className="app-skeleton h-4 w-28" />
    </div>)}
  </div>;
}

export function LoadingTableRows({ label, columns, count = 4 }: { label: string; columns: number; count?: number }) {
  return <>{Array.from({ length: count }, (_, row) => <tr key={row} aria-hidden="true" className="border-b border-white/5 last:border-0">
    {Array.from({ length: columns }, (_, column) => <td key={column} className="px-6 py-5"><span className={`app-skeleton h-4 ${column === 0 ? "w-32" : "w-20"} max-w-full`} /></td>)}
  </tr>)}<tr className="sr-only"><td colSpan={columns} role="status">{label}</td></tr></>;
}
