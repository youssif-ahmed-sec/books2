import { notifyError, notifyOffline } from "@/lib/notifications";

export const API_BASE_URL = "/api/v1";

interface FetchOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function fetchApi(endpoint: string, options: FetchOptions = {}) {
  const { requireAuth = true, headers = {}, ...rest } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Type", "application/json");

  if (requireAuth) {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (token) {
      requestHeaders.set("Authorization", `Bearer ${token}`);
    } else {
      // If auth is required but no token is found, redirect to login
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        window.location.href = "/login";
        throw new Error("No access token found");
      }
    }
  }

  const url = `${API_BASE_URL}${endpoint}`;
  
  let response: Response;
  try {
    response = await fetch(url, {
      headers: requestHeaders,
      ...rest,
    });
  } catch (cause) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      notifyOffline();
      throw new Error("انقطع الاتصال بالإنترنت. حاول مرة أخرى بعد عودة الاتصال.", { cause });
    }
    const message = "تعذر الاتصال بالخادم. حاول مرة أخرى بعد قليل.";
    notifyError(message);
    throw new Error(message, { cause });
  }

  if (!response.ok) {
    if (response.status >= 500) notifyError("حدث خطأ بالخادم. حاول مرة أخرى بعد قليل.");
    if (response.status === 401 && requireAuth) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
      }
    }
    
    let errorMessage = "An error occurred";
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorData.message || errorMessage;
    } catch {
      // Ignore JSON parse error for error response
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  try {
    return await response.json();
  } catch (cause) {
    const message = "تعذر قراءة رد الخادم. حاول مرة أخرى بعد قليل.";
    notifyError(message);
    throw new Error(message, { cause });
  }
}
