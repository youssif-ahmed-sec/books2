export const NOTIFICATIONS_CHANGED_EVENT = "books2:notifications-changed";

export function refreshNotificationBell(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
