# Temporary WhatsApp Service

A lightweight REST API service built with Hono.js that enables us to send WhatsApp messages programmatically using WhatsApp Web. Perfect for temporary messaging needs, notifications, or testing purposes.

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
cd so-whatsapp-bot
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
PORT=3000
```

5. Run in development mode
```bash
npm run dev
```

6. Open **http://localhost:3000/app** to scan the QR code (or use the terminal/Docker logs)

### Docker Deployment

The easiest way to run this service is using Docker, which comes with Chromium pre-installed.

```bash
# Build and start the service
docker-compose up -d

# Open dashboard (QR scan + send message) at http://localhost:3001/app
# Or view logs for QR in terminal (first time only)
docker-compose logs -f whatsapp-bot

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
  "message": "Hello from Temporary WhatsApp Service!"
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
- Body API hanya butuh **nomor HP** + **pesan** (bukan chatId / LID)
- Format nomor: `08xx…`, `628xx…`, atau `+628xx…` (otomatis dinormalisasi ke `62…`)
- Jangan kirim angka ID internal WhatsApp (LID), contoh `274083405140014` — itu bukan nomor HP
- Contoh benar: `{ "phoneNumber": "6281234567890", "message": "Halo" }`

### Status WhatsApp
```http
GET /whatsapp/status
```
Tunggu `ready: true` (dan log `compat=on`) sebelum mengirim.

### Daftar chat
```http
GET /whatsapp/chats?type=personal
```
Setiap chat pribadi sebaiknya punya `phoneNumber` (di-resolve dari `@lid` bila perlu). UI memakai field ini untuk kirim.

## Usage Examples

### Using cURL

```bash
curl -X POST http://localhost:3000/whatsapp/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "08123456789",
    "message": "Hello! This is a test message."
  }'
```

### Using JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:3000/whatsapp/send-message', {
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
    'http://localhost:3000/whatsapp/send-message',
    json={
        'phoneNumber': '08123456789',
        'message': 'Hello from Python!'
    }
)

print(response.json())
```

## Project Structure

```
so-whatsapp-bot/
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
docker build -t temporary-whatsapp-service .

# Run the container
docker run -p 3000:3000 \
  -v whatsapp-session:/app/.wwebjs_auth \
  temporary-whatsapp-service
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `BROWSER_PATH` | Path to Chromium/Chrome executable | Auto-detected |
| `NODE_ENV` | Environment (development/production) | `development` |

## Web Dashboard (Phase 1)

Buka **http://localhost:3000/app** (atau port Docker Anda, mis. `3001`) untuk:

| Halaman | URL | Fungsi |
|---------|-----|--------|
| Koneksi | `/app` | QR code, status, reconnect & logout |
| Grup | `/app/groups` | Daftar grup, riwayat pesan, kirim ke grup |
| Pribadi | `/app/personal` | Daftar chat, riwayat pesan, balas chat |
| Kirim cepat | `/app/send` | Kirim ke nomor baru tanpa buka riwayat |

Menu navigasi di sidebar mengarah ke masing-masing halaman. Halaman chat otomatis mengarahkan ke `/app` jika WhatsApp belum **ready**.

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
