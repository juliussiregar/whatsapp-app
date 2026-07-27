# SolidPace Bot

WhatsApp bot untuk SolidPace — catat asupan makanan atlet lewat chat, plus REST API WhatsApp Web.

## Tech Stack

- **Framework**: [Hono.js](https://hono.dev/) - Ultrafast web framework
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **WhatsApp Client**: whatsapp-web.js
- **Browser Automation**: Puppeteer with Chromium

## Prerequisites

- Node.js 20 or higher
- npm or yarn
- Chromium/Chrome browser (or use Docker)

## Installation

### Local Development

1. Clone the repository
```bash
git clone <repository-url>
cd solidpace-bot
```

2. Install dependencies
```bash
npm install
```

3. Create environment file
```bash
cp .env.example .env
```

4. Set the browser path in `.env` (optional if Chromium is in PATH)
```env
BROWSER_PATH=/path/to/chromium
PORT=3044
```

5. Run in development mode
```bash
npm run dev
```

6. Open **http://localhost:3044/app** to scan the QR code (or use the terminal/Docker logs)

### Docker Deployment

The easiest way to run this service is using Docker, which comes with Chromium pre-installed.

```bash
# Build and start the service
docker-compose up -d

# Open dashboard (QR scan + send message) at http://localhost:3044/app
# Or view logs for QR in terminal (first time only)
docker-compose logs -f solidpace-bot

# Stop the service
docker-compose down
```

## API Endpoints

### Health Check
Check if the service is running.

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-13T10:30:00.000Z",
  "uptime": 123.456
}
```

### Send WhatsApp Message
Send a message to a WhatsApp number.

```http
POST /whatsapp/send-message
Content-Type: application/json
```

**Request Body:**
```json
{
  "phoneNumber": "08123456789",
  "message": "Hello from SolidPace Bot!"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "to": "628123456789"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Failed to send message",
  "details": "Error message here"
}
```

**Notes:**
- Phone numbers starting with `0` are automatically converted to `62` (Indonesian country code)
- You can send to international numbers by using the full country code (e.g., `6281234567890`)

## Usage Examples

### Using cURL

```bash
curl -X POST http://localhost:3044/whatsapp/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "08123456789",
    "message": "Hello! This is a test message."
  }'
```

### Using JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:3044/whatsapp/send-message', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    phoneNumber: '08123456789',
    message: 'Hello from my app!'
  })
});

const result = await response.json();
console.log(result);
```

### Using Python

```python
import requests

response = requests.post(
    'http://localhost:3044/whatsapp/send-message',
    json={
        'phoneNumber': '08123456789',
        'message': 'Hello from Python!'
    }
)

print(response.json())
```

## Project Structure

```
solidpace-bot/
├── src/
│   ├── clients/
│   │   └── whatsapp.ts      # WhatsApp client initialization
│   ├── routes/
│   │   ├── health.ts        # Health check endpoint
│   │   └── whatsapp.ts      # WhatsApp message endpoints
│   ├── utils/
│   │   └── time.ts          # Utility functions
│   └── index.ts             # Application entry point
├── .env.example             # Environment variables template
├── .gitignore
├── Dockerfile               # Docker configuration
├── docker-compose.yml       # Docker Compose configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Build and Deploy

### Build for Production

```bash
# Compile TypeScript
npm run build

# Run production build
npm start
```

### Docker Build

```bash
# Build the image
docker build -t solidpace-bot .

# Run the container
docker run -p 3044:3044 \
  -v solidpace-session:/app/.wwebjs_auth \
  solidpace-bot
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3044` |
| `BROWSER_PATH` | Path to Chromium/Chrome executable | Auto-detected |
| `NODE_ENV` | Environment (development/production) | `development` |

## Web Dashboard (Phase 1)

Buka **http://localhost:3044/app** untuk:

| Halaman | URL | Fungsi |
|---------|-----|--------|
| Koneksi | `/app` | QR code, status, reconnect & logout |
| Grup | `/app/groups` | Daftar grup, riwayat pesan, kirim ke grup |
| Pribadi | `/app/personal` | Daftar chat, riwayat pesan, balas chat |
| Kirim cepat | `/app/send` | Kirim ke nomor baru tanpa buka riwayat |

Menu navigasi di sidebar mengarah ke masing-masing halaman. Halaman chat otomatis mengarahkan ke `/app` jika WhatsApp belum **ready**.

## SolidPace Nutrition Bot

Bot WhatsApp untuk atlet SolidPace — catat asupan makanan lewat chat pribadi.

### Fitur

- **Teks bebas** — contoh: `nasi ayam 300gr dinner`
- **Foto makanan** — analisis AI (`save=false`) lalu konfirmasi sebelum simpan
- **Kategori otomatis** — berdasarkan jam WIB atau kata kunci di pesan (sarapan/siang/snack/malam)
- Upload aktivitas `.fit/.tcx/.gpx` **belum didukung** lewat WhatsApp

### Environment

| Variable | Wajib | Deskripsi |
|----------|-------|-----------|
| `SOLIDPACE_BOT_ENABLED` | | `true` / `false` (default: `true`) |
| `WHATSAPP_BOT_API_KEY` | ✓ | API key SolidPace Integration |
| `SOLIDPACE_API_BASE_URL` | | Default: `https://api-solid.aluesagd.com/api/v1` |
| `OPENAI_API_KEY` | ✓ | Ekstraksi teks makanan bebas |
| `OPENAI_MODEL_FAST` | | Model OpenAI (default: `gpt-4.1-mini`) |
| `SOLIDPACE_FETCH_TIMEOUT_MS` | | Timeout HTTP ke SolidPace (default: `30000`) |

Salin dari `.env.example`, lalu jalankan:

```bash
npm run dev
```

Kirim `help` ke nomor bot setelah status **ready**.

### Alur chat

1. User kirim teks/foto makanan
2. Bot lookup nomor di SolidPace (404 → hubungi admin)
3. Bot tampilkan ringkasan nutrisi
4. User balas `ya` untuk simpan, `batal` untuk batalkan

### Testing

```bash
npm test
```

| Endpoint | Deskripsi |
|----------|-----------|
| `GET /whatsapp/qr` | QR login (data URL PNG) |
| `GET /whatsapp/chats?type=group\|personal\|all` | Daftar chat |
| `GET /whatsapp/messages?chatId=...&limit=50` | Riwayat pesan |
| `GET /whatsapp/groups` | Daftar grup (ringkas) |
| `POST /whatsapp/send-group-message` | Kirim ke grup |

## First Time Setup

1. Start the service (locally or with Docker)
2. Buka `/app` di browser **atau** lihat QR di console/logs
3. Open WhatsApp on your phone
4. Go to **Settings** > **Linked Devices** > **Link a Device**
5. Scan the QR code
6. Wait for status **ready** on the dashboard
7. Your session is now saved and will persist across restarts

## Troubleshooting

### QR Code Not Showing
- Make sure no other WhatsApp Web sessions are blocking the connection
- Clear the `.wwebjs_auth` directory and restart

### Browser Process Errors
The service automatically cleans up browser processes on startup. If you encounter issues:
```bash
# Manually kill browser processes
pkill -f "chromium.*wwebjs_auth"
```

### Message Not Sending
- Ensure WhatsApp is connected (check logs)
- Verify the phone number is registered on WhatsApp
- Check if you're rate-limited by WhatsApp

## Limitations

- This service uses WhatsApp Web, so it requires your phone to be connected to the internet
- WhatsApp may detect automated behavior and temporarily block the account
- Not recommended for high-volume or commercial use
- Use responsibly and comply with WhatsApp's Terms of Service

## License

MIT

## Disclaimer

This project is for educational and personal use only. Use at your own risk. The developers are not responsible for any misuse or violations of WhatsApp's Terms of Service.
