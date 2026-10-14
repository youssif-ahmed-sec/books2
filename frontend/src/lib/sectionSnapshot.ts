// Keep the previous view in memory during client-side navigation. Each mounted
// section still revalidates against the API; nothing is persisted to disk.
const snapshots = new Map<string, { token: string; data: unknown }>();
let revision = 0;

function token() {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

export function readSectionSnapshot<T>(section: string): T | null {
  const current = token();
  const saved = snapshots.get(section);
  return current && saved?.token === current ? saved.data as T : null;
}

export function writeSectionSnapshot<T>(section: string, data: T) {
  const current = token();
  if (current) snapshots.set(section, { token: current, data });
}

export function clearSectionSnapshots() {
  snapshots.clear();
  revision++;
}

export function sectionSnapshotRevision() { return revision; }
