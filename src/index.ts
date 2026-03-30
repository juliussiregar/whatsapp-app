import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { serve } from "@hono/node-server";
import health from "@/routes/health.js";
import whatsapp from "@/routes/whatsapp.js";
import { init as initWhatsApp } from "@/clients/whatsapp.js";

const app = new OpenAPIHono();

// Mount sub-apps (OpenAPIHono instances — docs will be merged automatically)
app.route("/health", health);
app.route("/whatsapp", whatsapp);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    message: "Welcome to Simple WhatsApp API",
    version: "1.0.0",
    docs: "/docs",
  });
});

// Auto-generate OpenAPI JSON spec
app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "Simple WhatsApp API",
    version: "1.0.0",
    description: `REST API untuk mengirim pesan WhatsApp menggunakan whatsapp-web.js.

## Cara Penggunaan
1. Pastikan status client sudah **ready** dengan mengecek endpoint \`GET /whatsapp/status\`
2. Scan QR code yang muncul di console/log Docker saat pertama kali menjalankan service
3. Setelah ready, Anda bisa mulai mengirim pesan

## Format Nomor Telepon
- \`08xxxxxxxxxx\` → otomatis dikonversi ke \`628xxxxxxxxxx\`
- \`628xxxxxxxxxx\` → langsung digunakan
- \`+628xxxxxxxxxx\` → karakter non-digit diabaikan

## Format Group ID
Group ID harus dalam format: \`123456789012345678@g.us\`
Gunakan endpoint \`GET /whatsapp/groups\` untuk mendapatkan daftar group ID.`,
  },
  tags: [
    { name: "Health", description: "Health check service" },
    { name: "WhatsApp - Status", description: "Status dan manajemen koneksi WhatsApp" },
    { name: "WhatsApp - Personal", description: "Kirim pesan ke nomor pribadi" },
    { name: "WhatsApp - Group", description: "Kirim pesan ke grup WhatsApp" },
    { name: "WhatsApp - Management", description: "Manajemen session, auth, dan cache" },
  ],
});

// Serve Swagger UI
app.get("/docs", swaggerUI({ url: "/doc" }));

const port = Number(process.env.PORT) || 3000;

// Initialize WhatsApp client
initWhatsApp().catch((error) => {
  console.error("Failed to initialize WhatsApp client:", error);
});

// Start Hono server
serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
    console.log(`Swagger UI: http://localhost:${info.port}/docs`);
  },
);
