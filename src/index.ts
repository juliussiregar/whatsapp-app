import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import health from "@/routes/health.js";
import whatsapp from "@/routes/whatsapp.js";
import {
  init as initWhatsApp,
  setInboundMessageHandler,
} from "@/clients/whatsapp.js";
import { handleInboundMessage } from "@/bot/inbound.js";
import { isSolidPaceBotEnabled, validateSolidPaceBotEnv } from "@/config.js";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

try {
  validateSolidPaceBotEnv();
} catch (err) {
  console.error("[SolidPace Bot] Konfigurasi env tidak valid:", err);
  process.exit(1);
}

if (isSolidPaceBotEnabled()) {
  setInboundMessageHandler(handleInboundMessage);
  console.info("[SolidPace Bot] inbound handler enabled");
} else {
  console.info("[SolidPace Bot] disabled (SOLIDPACE_BOT_ENABLED=false)");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const app = new OpenAPIHono();

// Mount sub-apps (OpenAPIHono instances — docs will be merged automatically)
app.route("/health", health);
app.route("/whatsapp", whatsapp);

app.get("/app", serveStatic({ root: publicDir, path: "index.html" }));
app.get("/app/groups", serveStatic({ root: publicDir, path: "groups.html" }));
app.get("/app/personal", serveStatic({ root: publicDir, path: "personal.html" }));
app.get("/app/send", serveStatic({ root: publicDir, path: "send.html" }));
app.get("/app/group-manage", serveStatic({ root: publicDir, path: "group-manage.html" }));
app.use(
  "/app/*",
  serveStatic({
    root: publicDir,
    rewriteRequestPath: (p) => p.replace(/^\/app/, "") || "/",
  }),
);

// Root endpoint
app.get("/", (c) => {
  return c.redirect("/app", 302);
});

// Auto-generate OpenAPI JSON spec
app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "SolidPace Bot",
    version: "1.0.0",
    description: `Bot WhatsApp SolidPace + REST API (whatsapp-web.js).

## Cara Penggunaan
1. Buka dashboard web di \`/app\` untuk scan QR dan kirim pesan
2. Pastikan status client sudah **ready** dengan mengecek endpoint \`GET /whatsapp/status\`
3. Setelah ready, Anda bisa mulai mengirim pesan / memakai bot nutrisi

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
    { name: "WhatsApp - Group", description: "Grup, chat, riwayat pesan, dan kirim ke grup" },
    { name: "WhatsApp - Management", description: "Manajemen session, auth, dan cache" },
  ],
});

// Serve Swagger UI
app.get("/docs", swaggerUI({ url: "/doc" }));

const port = Number(process.env.PORT) || 3044;

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
    console.log(`Dashboard: http://localhost:${info.port}/app`);
    console.log(`Swagger UI: http://localhost:${info.port}/docs`);
  },
);
