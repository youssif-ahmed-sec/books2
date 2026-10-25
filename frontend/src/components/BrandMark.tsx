interface BrandMarkProps {
  size?: "small" | "large";
}

export default function BrandMark({ size = "small" }: BrandMarkProps) {
  return (
    <div
      aria-label="مكتبة سعود الشافعي"
      role="img"
      className={`flex items-center justify-center rounded-2xl border border-primary/20 bg-surface-container-highest text-primary shadow-[0_8px_24px_rgba(0,0,0,.2)] ${
        size === "large" ? "h-24 w-24" : "h-20 w-20"
      }`}
    >
      <svg
        aria-hidden="true"
        className={size === "large" ? "h-14 w-14" : "h-12 w-12"}
        viewBox="0 0 48 48"
        fill="none"
      >
        <path d="M5 11.5c7-1.2 13.3.5 19 4.7V39c-5.7-4.2-12-5.9-19-4.7V11.5Z" fill="currentColor" />
        <path d="M43 11.5c-7-1.2-13.3.5-19 4.7V39c5.7-4.2 12-5.9 19-4.7V11.5Z" fill="currentColor" />
        <path d="M29 21c3-1.6 6-2.2 9-2M29 27c3-1.6 6-2.2 9-2M29 33c3-1.6 6-2.2 9-2" stroke="#353534" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
