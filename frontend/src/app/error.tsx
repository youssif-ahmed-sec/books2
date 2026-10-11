"use client";

export default function ErrorPage({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-outline-variant/40 bg-surface-container p-8 text-center shadow-2xl">
        <span aria-hidden="true" className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
          </svg>
        </span>
        <h1 className="text-xl font-bold text-on-surface">حصل خطأ غير متوقع</h1>
        <p className="mt-2 text-sm leading-7 text-on-surface-variant">تعذر عرض الصفحة حاليًا. حاول مرة أخرى، وإذا استمرت المشكلة تواصل مع المسؤول.</p>
        <button type="button" onClick={unstable_retry} className="mt-6 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          إعادة المحاولة
        </button>
      </section>
    </main>
  );
}
