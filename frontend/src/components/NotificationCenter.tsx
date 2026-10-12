"use client";

import { useEffect } from "react";
import { cssTransition, ToastContainer, toast } from "react-toastify";
import { notifyError, notifyOffline, notifySuccess, offlineToastId } from "@/lib/notifications";
import "react-toastify/dist/ReactToastify.css";

const quietToastMotion = cssTransition({
  enter: "app-toast-enter",
  exit: "app-toast-exit",
  collapse: false,
});

export default function NotificationCenter() {
  useEffect(() => {
    const onOffline = () => notifyOffline();
    const onOnline = () => {
      const wasOffline = toast.isActive(offlineToastId);
      toast.dismiss(offlineToastId);
      if (wasOffline) notifySuccess("رجع الاتصال بالإنترنت.");
    };
    const onUnexpectedError = () => notifyError("حدث خطأ غير متوقع. حاول إعادة العملية.");

    if (!navigator.onLine) onOffline();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("error", onUnexpectedError);
    window.addEventListener("unhandledrejection", onUnexpectedError);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("error", onUnexpectedError);
      window.removeEventListener("unhandledrejection", onUnexpectedError);
    };
  }, []);

  return (
    <ToastContainer
      position="bottom-right"
      rtl
      limit={3}
      autoClose={5500}
      newestOnTop
      pauseOnHover
      closeOnClick={false}
      transition={quietToastMotion}
      className="app-notification-center"
      toastClassName="app-notification"
      progressClassName="app-notification-progress"
    />
  );
}
