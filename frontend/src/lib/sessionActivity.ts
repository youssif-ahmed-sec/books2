// Attach input activity to a normal API request; background polling alone is not activity.
let pending: { token: string; sequence: number } | null = null;
let sequence = 0;
let lastSent = 0;
let inFlight = false;

export function markUserActivity() {
  const token = localStorage.getItem("access_token");
  if (token) pending = { token, sequence: ++sequence };
}

export function beginActivity(token: string | null): number | null {
  if (!token || pending?.token !== token || inFlight || Date.now() - lastSent < 30000) return null;
  inFlight = true;
  return pending.sequence;
}

export function finishActivity(token: string | null, sent: number | null, accepted: boolean) {
  if (sent === null) return;
  inFlight = false;
  if (!accepted) return;
  lastSent = Date.now();
  if (pending?.token === token && pending.sequence === sent) pending = null;
}
