"use client";

import { useEffect } from "react";
import { markUserActivity } from "@/lib/sessionActivity";

export default function SessionActivity() {
  useEffect(() => {
    const onActivity = (event: Event) => {
      if (event.isTrusted) markUserActivity();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach(name => window.addEventListener(name, onActivity, { passive: true }));
    return () => events.forEach(name => window.removeEventListener(name, onActivity));
  }, []);
  return null;
}
