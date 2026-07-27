const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isAllowedFoodImageMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return true;
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return ALLOWED_IMAGE_MIMES.has(normalized);
}

export function foodImageMimeErrorMessage(): string {
  return [
    "⚠️ Format foto tidak didukung.",
    "",
    "Kirim foto *JPEG, PNG, atau WebP* (bukan HEIC/dokumen).",
    "Atau tulis makanannya sebagai teks.",
  ].join("\n");
}
