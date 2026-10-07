"use client";

import { useSyncExternalStore } from "react";

const subscribe = (callback: () => void) => {
  window.addEventListener("books2-theme-change", callback);
  return () => window.removeEventListener("books2-theme-change", callback);
};
const getTheme = (): "light" | "dark" => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerTheme = (): "dark" => "dark";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("books2-theme", next);
    window.dispatchEvent(new Event("books2-theme-change"));
  };
  return <button type="button" onClick={toggle} className="app-icon-button" aria-label={theme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"} title={theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}>
    <span className="material-symbols-outlined">{theme === "dark" ? "light_mode" : "dark_mode"}</span>
  </button>;
}
