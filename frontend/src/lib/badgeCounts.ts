"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "./api";
import { NOTIFICATIONS_CHANGED_EVENT } from "./notificationEvents";

export type BadgeCounts = { product_approvals: number; purchases: number };

const emptyCounts: BadgeCounts = { product_approvals: 0, purchases: 0 };
let cachedCounts = emptyCounts;
let cachedToken: string | null = null;
let pending: { token: string; promise: Promise<BadgeCounts> } | null = null;
let refreshAfterPending = false;
const listeners = new Set<(counts: BadgeCounts) => void>();
let interval: number | null = null;

function currentToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

function publish(counts: BadgeCounts): void {
  cachedCounts = counts;
  listeners.forEach(listener => listener(counts));
}

function countsForCurrentUser(): BadgeCounts {
  const token = currentToken();
  if (token !== cachedToken) {
    cachedToken = token;
    cachedCounts = emptyCounts;
  }
  return cachedCounts;
}

export async function refreshBadgeCounts(): Promise<BadgeCounts> {
  const previousToken = cachedToken;
  countsForCurrentUser();
  if (previousToken !== cachedToken) publish(emptyCounts);
  const token = cachedToken;
  if (!token) return emptyCounts;
  if (pending?.token === token) return pending.promise;

  const promise = (async () => {
    try {
      const response = await fetchApi("/notifications/badge-counts", { silentErrors: true }) as BadgeCounts;
      if (currentToken() === token &&
          typeof response?.product_approvals === "number" && typeof response?.purchases === "number") {
        publish(response);
      }
    } catch {
      // A later focus or notification event retries without showing a second error.
    }
    return countsForCurrentUser();
  })();
  pending = { token, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) {
      pending = null;
      if (refreshAfterPending) {
        refreshAfterPending = false;
        void refreshBadgeCounts();
      }
    }
  }
}

function onRefresh(): void {
  if (pending?.token === currentToken()) {
    refreshAfterPending = true;
    return;
  }
  void refreshBadgeCounts();
}

function onVisibility(): void {
  if (document.visibilityState === "visible") onRefresh();
}

function subscribe(listener: (counts: BadgeCounts) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onRefresh);
    window.addEventListener("focus", onRefresh);
    window.addEventListener("storage", onRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    interval = window.setInterval(onVisibility, 60000);
  }
  void refreshBadgeCounts();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("storage", onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
      if (interval !== null) window.clearInterval(interval);
      interval = null;
    }
  };
}

export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>(countsForCurrentUser);
  useEffect(() => subscribe(setCounts), []);
  return counts;
}
