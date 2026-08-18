# Handoff — WhatsApp Bot Integration API

**Tanggal:** 2026-07-21  
**Audience:** Tim bot WhatsApp / integrator server-to-server  
**Base URL:** `/api/v1`  
**Auth:** header `X-API-Key` saja — **tanpa JWT / login user**  
**Swagger:** `/docs` → tag **WhatsApp Integration**

---

## 1. Ringkasan

Bot WhatsApp menerima pesan/foto dari atlet, lalu memanggil API SolidPace. Atlet diidentifikasi lewat **nomor telepon** yang sudah terdaftar di profil SolidPace (`users.phone`).

| # | Kebutuhan | Method | Path |
|---|-----------|--------|------|
| 1 | Cek user + kategori nutrisi | `GET` | `/integrations/whatsapp/users/by-phone` |
| 2 | Catat makanan (data sudah diketahui) | `POST` | `/integrations/whatsapp/nutrition/food` |
| 3 | Foto makanan → AI vision | `POST` | `/integrations/whatsapp/nutrition/analyze-image` |
| 4 | Catat aktivitas **manual teks** | `POST` | `/integrations/whatsapp/training-sessions` |

### Scope aktivitas latihan di WhatsApp

| ✅ Dipakai | ❌ Tidak dipakai |
|-----------|-----------------|
| Input manual via chat (teks) | Upload file device (.fit / .tcx / .gpx) |
| Bot parse tanggal & durasi user | Stopwatch live timer |
| | Import/sync dari jam lewat WA |

**Upload file aktivitas dari device tidak didukung di channel WhatsApp.** Atlet yang punya file jam tetap upload lewat **aplikasi SolidPace** (`POST /training-sessions/upload` dengan JWT).

**Training session** = aktivitas **sudah selesai** (actual). **Workout** = rencana — tidak ada endpoint WA.

---

## 2. Autentikasi

Semua request wajib header:

```http
X-API-Key: <WHATSAPP_BOT_API_KEY>
```

| HTTP | Arti |
|------|------|
| `401` | Key tidak ada / salah |
| `503` | `WHATSAPP_BOT_API_KEY` belum diset di server BE |

**Keamanan:**
- Simpan key **hanya** di server bot (env / secret manager).
- Jangan kirim key ke client HP user.
- Rotasi: update env BE + bot bersamaan.

---

## 3. Nomor telepon

BE menormalisasi format Indonesia:

| Input bot | Cocok DB |
|-----------|----------|
| `+6281234567890` | `+628...`, `08...`, `628...` |
| `081234567890` | sama |

| HTTP | Arti |
|------|------|
| `404` | Nomor belum terdaftar di profil SolidPace |
| `400` | Format nomor tidak valid |

**Onboarding:** arahkan atlet isi nomor di profil app dulu.

---

## 4. Endpoint detail

### 4.1 Resolve user

```http
GET /integrations/whatsapp/users/by-phone?phone=%2B6281234567890
X-API-Key: ...
```

**Response `200`:**

```json
{
  "data": {
    "user_id": 24,
    "full_name": "Adi Nugroho",
    "phone": "+628111111111",
    "categories": [
      { "category_id": 1, "name": "Breakfast" },
      { "category_id": 2, "name": "Lunch" }
    ]
  }
}
```

---

### 4.2 Log makanan

```http
POST /integrations/whatsapp/nutrition/food
```

```json
{
  "phone": "+6281234567890",
  "category_id": 2,
  "food_name": "Nasi goreng",
  "serving": 250,
  "suffix_serving": "gr",
  "calories": 450,
  "fat": 12,
  "protein": 10
}
```

---

### 4.3 Analisis foto makanan (AI)

```http
POST /integrations/whatsapp/nutrition/analyze-image
Content-Type: multipart/form-data
```

| Field | Required |
|-------|----------|
| `phone` | ✓ |
| `file` | ✓ (JPEG/PNG/WebP) |
| `category_id` | jika `save=true` |
| `save` | default `true` |

Flow disarankan: `save=false` → konfirmasi user → `save=true` atau panggil 4.2.

---

### 4.4 Catat aktivitas manual (chat teks)

Untuk intent seperti *"catat lari 40 menit tanggal 17 Juli"*.

```http
POST /integrations/whatsapp/training-sessions
X-API-Key: ...
Content-Type: application/json
```

#### Field body (kontrak API — ketat)

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `phone` | string | ✓ | Nomor WA |
| `activity_type` | string | ✓ | `run`, `bike`, `swim`, `strength`, `walk`, … |
| `session_date` | datetime ISO | ✓ | `"2026-07-17T06:00:00"` — **bot** yang convert dari input user |
| `duration` | int | ✓ | **Detik** — **bot** yang convert dari menit/jam user |
| `session_name` | string | | Default: `"Run (WhatsApp)"` |
| `distance` | float | | km — opsional |
| `hr_avg` / `hr_max` | float | | opsional |
| `notes` | string | | max 2000 |

> **Parsing natural language bukan tanggung jawab BE.** Bot terima teks bebas dari user, convert, baru POST ke API.

#### 4.4.1 Bot: convert `session_date` (tanggal user → ISO)

User di WA bisa menulis tanggal dengan berbagai gaya. **Bot** parse dulu, lalu kirim ISO ke API:

| Contoh input user | Bot kirim ke API (`session_date`) |
|-------------------|-----------------------------------|
| `17 Juli` / `17 juli 2026` | `"2026-07-17T06:00:00"` |
| `17-07-2026` | `"2026-07-17T06:00:00"` |
| `07/17/26` | `"2026-07-17T06:00:00"` (hati-hati format ambigu — konfirmasi user) |
| `hari ini` | tanggal hari ini + jam default (mis. 06:00) |
| `kemarin` | kemarin + jam default |
| `jam 7 pagi tadi` | `"2026-07-21T07:00:00"` |

**Alur bot:**
1. Terima teks natural dari user.
2. Parse + **konfirmasi singkat** ke user jika ambigu.
3. POST ke API dengan **ISO 8601** saja.

#### 4.4.2 Bot: convert durasi (menit/jam user → detik)

API **hanya** terima `duration` dalam **detik**. Bot convert sebelum POST:

| User bilang | Bot hitung | `duration` ke API |
|-------------|------------|-------------------|
| 40 menit | 40 × 60 | `2400` |
| 1 jam | 60 × 60 | `3600` |
| 1 jam 30 menit | 90 × 60 | `5400` |
| 45 menit | 45 × 60 | `2700` |

Jika user hanya bilang angka tanpa satuan → **tanya ulang**: *"40 menit atau 40 detik?"*

#### Contoh lengkap

User: *"Lari 5km, 40 menit, tanggal 17 Juli"*

Bot parse → POST:

```json
{
  "phone": "+628111111111",
  "activity_type": "run",
  "session_date": "2026-07-17T06:00:00",
  "duration": 2400,
  "distance": 5.0,
  "session_name": "Lari via WA"
}
```

#### Response `200`

```json
{
  "data": {
    "id": 502,
    "activity_type": "run",
    "session_date": "2026-07-17T06:00:00",
    "duration": 2400,
    "distance": 5.0,
    "tss": 28.5,
    "source": "manual",
    "source_label": "WhatsApp",
    "import_channel": "whatsapp",
    "excluded_from_load": false
  },
  "message": "Training session berhasil dicatat via WhatsApp"
}
```

| Field | Nilai | Arti |
|-------|-------|------|
| `source` | `"manual"` | Ikut load-overlap |
| `import_channel` | `"whatsapp"` | Bedakan dari manual di app |
| `duration` | detik | Selalu detik di response |

Response bisa menyertakan `load_overlap` jika bentrok dengan session Garmin/stopwatch di hari & waktu sama.

---

## 5. Alur bot (recommended)

```
Pesan masuk WA (nomor pengirim)
        │
        ▼
GET /users/by-phone?phone=<wa_id>
        │
   ┌────┴────┐
   │ 404     │ 200
   ▼         ▼
"Daftar     Intent:
 dulu"      ├─ Foto makanan     → analyze-image
            ├─ Teks nutrisi     → nutrition/food
            └─ Teks aktivitas   → bot parse tanggal+menit
                                   → POST training-sessions (ISO + detik)
```

**Tips:**
- Kirim `phone` apa adanya dari WA; BE normalisasi nomor.
- Aktivitas: bot parse §4.4.1 + §4.4.2 → API terima ISO + detik saja.
- **Jangan** terima/forward file .fit/.gpx untuk aktivitas — arahkan ke app jika user punya file jam.
- Vision makanan: `save=false` dulu untuk konfirmasi.

---

## 6. Testing lokal

```bash
cd docker && docker compose -f docker-compose.dev.yaml up -d app
cd ..
WHATSAPP_BOT_API_KEY=<key-dari-env> ./script/test_whatsapp_integration.sh
```

Smoke mencakup: auth, resolve phone, log food, manual session (ISO + `duration` detik).

---

## 7. Checklist integrator

- [ ] `WHATSAPP_BOT_API_KEY` di env bot (server-side only)
- [ ] Handle `404` → arahkan isi nomor di profil SolidPace
- [ ] Resolve user sebelum log data
- [ ] Aktivitas **hanya manual teks** → `POST .../training-sessions`
- [ ] Bot parse tanggal user → ISO (§4.4.1) **sebelum** POST
- [ ] Bot parse durasi user (menit/jam) → detik (§4.4.2) **sebelum** POST
- [ ] **Tidak** implement upload file aktivitas di WA
- [ ] Vision: pertimbangkan `save=false` untuk konfirmasi
- [ ] Opsional: tampilkan info `load_overlap` ke user

---

## 8. Production

| Item | Catatan |
|------|---------|
| Base URL | Mis. `https://api-solid.aluesagd.com/api/v1` |
| API key | Secret unik per environment — minta ke tim BE |
| OpenAI | Wajib untuk `analyze-image` |

Hubungi tim BE untuk API key production dan URL final.
