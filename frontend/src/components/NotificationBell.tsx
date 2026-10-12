"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/currentUser";
import { armUiSound, notificationSoundEnabled, playUiSound } from "@/lib/uiSounds";

type Notice = {
  id: string;
  kind: string;
  title: string;
  message: string;
  href: string;
  created_at: string;
  read_at: string | null;
};
type Inbox = { items: Notice[]; unread_count: number };

const seenByUser = new Map<string, string>();
const soundKey = (id: string) => `books2-notification-sound:${id}`;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<Inbox>({ items: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const userId = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const next = await fetchApi("/notifications", { silentErrors: true }) as Inbox;
      if (version !== requestVersion.current) return;
      const id = userId.current;
      if (!id) return;
      const newest = next.items[0]?.id;
      const previous = seenByUser.get(id);
      if (newest && previous && newest !== previous && next.items.some((item) => item.id === newest && !item.read_at)) {
        if (notificationSoundEnabled(id) && document.visibilityState === "visible") playUiSound("notification");
      }
      if (newest) seenByUser.set(id, newest);
      setInbox(next);
      setError(false);
    } catch {
      if (version === requestVersion.current) setError(true);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser().then((user) => {
      if (!active) return;
      userId.current = user.id;
      setSoundEnabled(localStorage.getItem(soundKey(user.id)) !== "off");
      void refresh();
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && userId.current) void refresh(); }, 20000);
    const onVisibility = () => { if (document.visibilityState === "visible" && userId.current) void refresh(); };
    const onPointer = () => armUiSound();
    const onKey = () => armUiSound();
    const onOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onPointer, { once: true });
    document.addEventListener("keydown", onKey, { once: true });
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [refresh]);

  const markRead = async (id: string) => {
    try { await fetchApi(`/notifications/${id}/read`, { method: "POST", invalidateSnapshots: false, silentErrors: true }); await refresh(); }
    catch { setError(true); }
  };
  const markAllRead = async () => {
    try { await fetchApi("/notifications/read-all", { method: "POST", invalidateSnapshots: false, silentErrors: true }); await refresh(); }
    catch { setError(true); }
  };
  const toggleSound = () => {
    if (!userId.current) return;
    const enabled = !soundEnabled;
    localStorage.setItem(soundKey(userId.current), enabled ? "on" : "off");
    setSoundEnabled(enabled);
  };

  return <div className="relative" ref={root} dir="rtl">
    <button type="button" className="app-icon-button relative" aria-label={`الإشعارات${inbox.unread_count ? `: ${inbox.unread_count} غير مقروءة` : ""}`} aria-expanded={open}
      onClick={() => { setOpen(!open); if (!open) void refresh(); }}>
      <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
      {inbox.unread_count > 0 && <span className="notification-count" aria-hidden="true">{inbox.unread_count > 99 ? "99+" : inbox.unread_count}</span>}
    </button>
    {open && <section className="app-menu notification-menu absolute left-0 top-[calc(100%+10px)] w-[min(370px,calc(100vw-32px))] rounded-2xl p-3 shadow-2xl" aria-label="قائمة الإشعارات">
      <div className="flex items-center justify-between gap-3 px-2 pb-2">
        <h2 className="text-base font-bold">الإشعارات</h2>
        <button type="button" className="app-icon-button !h-9 !w-9" onClick={toggleSound} aria-label={soundEnabled ? "كتم أصوات النظام" : "تشغيل أصوات النظام"} title={soundEnabled ? "كتم أصوات النظام" : "تشغيل أصوات النظام"}>
          <span className="material-symbols-outlined text-xl" aria-hidden="true">{soundEnabled ? "volume_up" : "volume_off"}</span>
        </button>
      </div>
      {error && <p role="alert" className="rounded-lg px-3 py-2 text-sm text-red-300">تعذر تحديث الإشعارات. <button type="button" className="underline" onClick={() => void refresh()}>إعادة المحاولة</button></p>}
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {loading ? <p className="app-muted px-3 py-5 text-center text-sm">جاري تحميل الإشعارات...</p> : inbox.items.length ? inbox.items.map((item) =>
          <Link key={item.id} href={item.href} onClick={() => { setOpen(false); if (!item.read_at) void markRead(item.id); }} className={`notification-item block rounded-xl p-3 ${item.read_at ? "opacity-70" : ""}`}>
            <span className="flex items-start justify-between gap-2"><strong className="text-sm">{item.title}</strong>{!item.read_at && <i className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="غير مقروء" />}</span>
            <span className="app-muted mt-1 block text-sm leading-6">{item.message}</span>
            <time className="app-muted mt-1 block text-xs" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ar-EG")}</time>
          </Link>) : <p className="app-muted px-3 py-7 text-center text-sm">لا توجد إشعارات بعد</p>}
      </div>
      {inbox.unread_count > 0 && <button type="button" className="app-menu-action mt-2 w-full justify-center border-t border-white/10 text-primary" onClick={() => void markAllRead()}>تحديد الكل كمقروء</button>}
    </section>}
  </div>;
}
