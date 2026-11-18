export const NOTIFICATIONS_CHANGED_EVENT = "books2:notifications-changed";
export const NOTIFICATION_NAVIGATE_EVENT = "books2:notification-navigate";

export function refreshNotificationBell(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
