interface BrandMarkProps {
  size?: "small" | "large";
}

export default function BrandMark({ size = "small" }: BrandMarkProps) {
  return (
    <div
      aria-label="مكتبة سعود الشافعي"
      role="img"
      className={`flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary ${
        size === "large" ? "h-24 w-24" : "h-20 w-20"
      }`}
    >
      <svg
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className={size === "large" ? "h-14 w-14" : "h-12 w-12"}
      >
        <path d="M10 15c8-3 15-2 22 2v30c-7-4-14-5-22-2V15Zm44 0c-8-3-15-2-22 2v30c7-4 14-5 22-2V15Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M32 17v30" stroke="currentColor" strokeWidth="3.5" />
      </svg>
    </div>
  );
}
