/** Cegah POST dobel kalau user balas *ya* dua kali sebelum API selesai. */

const locks = new Set<string>();

export function isSaving(key: string): boolean {
  return locks.has(key);
}

/** true jika lock didapat. false jika sudah ada yang sedang menyimpan. */
export function beginSave(key: string): boolean {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}

export function endSave(key: string): void {
  locks.delete(key);
}

export function resetSaveLocksForTests(): void {
  locks.clear();
}
