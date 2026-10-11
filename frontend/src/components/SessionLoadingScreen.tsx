import BrandMark from "@/components/BrandMark";

export default function SessionLoadingScreen() {
  return (
    <main className="session-loading-shell" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">جاري تحميل الصفحة والتحقق من الجلسة</span>
      <div className="session-loading-orbit" aria-hidden="true">
        <svg className="session-loading-ring session-loading-ring--outer" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="83" />
          <circle cx="100" cy="100" r="83" />
        </svg>
        <svg className="session-loading-ring session-loading-ring--inner" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="65" />
          <circle cx="100" cy="100" r="65" />
        </svg>
        <div className="session-loading-logo"><BrandMark size="large" /></div>
      </div>
    </main>
  );
}
