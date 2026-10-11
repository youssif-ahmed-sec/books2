import { toast } from "react-toastify";

export function notifyError(message: string) {
  toast.error(message, { toastId: message });
}

export function notifySuccess(message: string) {
  toast.success(message, { toastId: message });
}

export const offlineToastId = "connection-offline";

export function notifyOffline() {
  toast.error("انقطع الاتصال بالإنترنت. راجع الشبكة ثم حاول مرة أخرى.", {
    toastId: offlineToastId,
    autoClose: false,
    closeOnClick: false,
  });
}
