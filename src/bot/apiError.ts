import { SolidPaceApiError } from "@/clients/solidpace.js";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isDurationTooSmall(msg: string): boolean {
  if (!/\bduration\b/.test(msg)) return false;
  return /greater than 0|exclusiveMinimum|must be >\s*0/.test(msg);
}

/** Pesan ke atlet dari error SolidPace (tanpa bocoran teknis berlebih). */
export function mapApiError(e: unknown): string {
  if (e instanceof SolidPaceApiError) {
    if (e.status === 404) {
      return "Nomor WhatsApp Anda belum terdaftar di SolidPace.\n\nSilakan hubungi *admin* terkait pendaftaran, dan pastikan nomor WA sudah diisi di profil SolidPace.";
    }
    if (e.status === 401) {
      const msg = e.message.toLowerCase();
      if (msg.includes("api key") || msg.includes("api-key") || msg.includes("x-api-key")) {
        return "Layanan bot belum dikonfigurasi dengan benar (API key). Hubungi admin teknis.";
      }
      return e.message || "Akun ini tidak berhak memakai bot. Hubungi *admin* jika menurut Anda ini kekeliruan.";
    }
    if (e.status === 400 || e.status === 422) {
      const msg = e.message.toLowerCase();
      if (msg.includes("category")) {
        return "Kategori makanan tidak ditemukan. Sebut *sarapan / siang / malam / snack*, atau ketik *help*.";
      }
      if (msg.includes("gambar") || msg.includes("image") || msg.includes("jpeg") || msg.includes("webp")) {
        return "Format foto tidak diterima. Kirim ulang *JPEG/PNG/WebP* yang jelas.";
      }
      if (isDurationTooSmall(msg)) {
        return "Durasi latihan harus lebih dari 0. Contoh: _40 menit_ / _1 jam_.";
      }
      if (msg.includes("telepon") || msg.includes("phone")) {
        return e.message;
      }
      return `Data tidak valid: ${e.message}`;
    }
    if (e.status === 503) {
      return "Layanan SolidPace sedang tidak siap. Hubungi admin teknis.";
    }
    if (e.name === "TimeoutError" || e.message.includes("aborted")) {
      return "Permintaan ke SolidPace terlalu lama. Coba lagi dalam beberapa saat.";
    }
    return `Gagal ke SolidPace (${e.status}): ${e.message}`;
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.message.includes("aborted"))) {
    return "Permintaan ke SolidPace terlalu lama. Coba lagi dalam beberapa saat.";
  }
  return `Terjadi kesalahan: ${errMsg(e)}`;
}
