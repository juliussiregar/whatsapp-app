# FE handoff — WhatsApp bot nutrition (karbo) · 2026-08-14

Dokumen **khusus tim bot WA**.  
Target Mifflin / `dcb` / dropdown profile → lihat [fe-handoff-nutrition-goal.md](fe-handoff-nutrition-goal.md) (bukan kerjaan bot kecuali chat nanti menampilkan target harian).

**Auth:** header `X-API-Key` (bukan JWT).  
Bot **tidak** pakai `/actual/me/*`, `/food`, atau `/auth/me`.

Swagger: tag **WhatsApp Integration** di `/docs` (contoh request/response sudah termasuk `carbo`).

---

## Perubahan ringkas

Karbo asupan sekarang first-class, sejajar fat/protein.

| Endpoint | Request | Response |
|----------|---------|----------|
| `POST /api/v1/integrations/whatsapp/nutrition/food` | `carbo` opsional (gram) | `carbo` + `total_actual_carbograms` |
| `POST /api/v1/integrations/whatsapp/nutrition/analyze-image` | (multipart; tidak ubah form) | `analysis.items[].carbo`, `analysis.totals.carbo`; kalau `save=true`: `saved.carbo` + `saved.total_actual_carbograms` |

Kalau `carbo` tidak dikirim / null, BE isi `(calories − protein×4 − fat×9) / 4` (min 0). Tidak 422.

**Bot baru:** kirim `carbo` kalau sudah ada dari AI/user; tampilkan gram karbo di chat konfirmasi.

---

## 1. Log makanan (teks / angka manual)

`POST /api/v1/integrations/whatsapp/nutrition/food`

**Request**

```
X-API-Key: <key>
Content-Type: application/json
```

```json
{
  "phone": "+6281234567890",
  "category_id": 1,
  "food_name": "Nasi putih",
  "serving": 100,
  "suffix_serving": "gr",
  "calories": 130,
  "fat": 0.3,
  "protein": 2.7,
  "carbo": 28
}
```

`carbo` boleh di-omit (fallback estimasi).

**Response** `200` (field makro)

```json
{
  "data": {
    "user_id": 24,
    "actual_id": 49,
    "category_id": 1,
    "food_name": "Nasi putih",
    "serving": 100,
    "suffix_serving": "gr",
    "calories": 130.0,
    "fat": 0.3,
    "protein": 2.7,
    "carbo": 28.0,
    "total_actual_calories": 130.0,
    "total_actual_fatgrams": 0.3,
    "total_actual_proteingrams": 2.7,
    "total_actual_carbograms": 28.0,
    "sub_actual_id": 138,
    "food_id": 37,
    "created_at": "2026-08-14T17:39:05"
  },
  "message": "Makanan berhasil dicatat"
}
```

---

## 2. Analisis foto (+ optional save)

`POST /api/v1/integrations/whatsapp/nutrition/analyze-image`

**Form fields (multipart):** `phone`, `file`, `category_id` (wajib jika `save=true`), `portion_hint` (opsional), `save` (default `true`).

**Response** — yang relevan untuk karbo:

- `data.analysis.items[]`: `calories`, `fat`, `protein`, `carbo`
- `data.analysis.totals`: `calories`, `fat`, `protein`, `carbo`
- `data.saved` (jika `save=true`): sama seperti log food → `carbo` + `total_actual_carbograms`

Contoh cuplikan:

```json
{
  "data": {
    "analysis": {
      "items": [
        {
          "food_name": "Nasi goreng",
          "serving": 250.0,
          "suffix_serving": "gr",
          "calories": 420.0,
          "fat": 15.0,
          "protein": 12.0,
          "carbo": 55.0,
          "confidence": 0.78
        }
      ],
      "totals": {
        "food_name": "Nasi goreng ayam",
        "serving": 250.0,
        "suffix_serving": "gr",
        "calories": 420.0,
        "fat": 15.0,
        "protein": 12.0,
        "carbo": 55.0
      }
    },
    "saved": {
      "carbo": 55.0,
      "total_actual_carbograms": 55.0
    }
  }
}
```

---

## Checklist bot

- [ ] Parse & kirim `carbo` saat user/AI sudah punya angka
- [ ] Tampilkan karbo (g) di bubble konfirmasi, sejajar kalori / protein / lemak
- [ ] Setelah save, boleh tampilkan total meal `total_actual_carbograms` jika UX butuh
- [ ] Jangan hardcode ke endpoint JWT app (`/actual/me/today`, dll.)

---

## Bukan scope bot (kecuali produk minta)

- `nutrition_goal`, PAL / `poin_aktivitas`
- Target harian `dct` / `dpt` / `dft` / `dcb`
- Meal split `breakfast_karbo` dst.
