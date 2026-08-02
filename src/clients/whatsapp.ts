import { promises as fs } from "fs";
import { Client } from "whatsapp-web.js";
import qrCode from "qrcode-terminal";
import QRCode from "qrcode";
import { applySerializedIdCompat } from "@/bot/waSerializedCompat.js";

const AUTH_DIR = "./.wwebjs_auth";

// ── State tracking ──────────────────────────────────────────────────
type ClientState =
  | "initializing"
  | "waiting_qr"
  | "authenticated"
  | "loading"
  | "ready"
  | "disconnected"
  | "error";

let clientState: ClientState = "initializing";
let stateChangedAt: Date = new Date();
let lastError: string | null = null;
let initStartedAt: Date = new Date();
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let latestQr: string | null = null;
let qrUpdatedAt: Date | null = null;

function clearQr() {
  latestQr = null;
  qrUpdatedAt = null;
}

async function setQr(qr: string) {
  latestQr = qr;
  qrUpdatedAt = new Date();
}

// Berapa lama (ms) setelah authenticated tapi belum ready → auto-reconnect
const AUTO_RECONNECT_TIMEOUT_MS = 3 * 60 * 1000; // 3 menit

function setState(newState: ClientState, error?: string) {
  const prev = clientState;
  clientState = newState;
  stateChangedAt = new Date();
  lastError = error ?? null;
  console.info(`[WA State] ${prev} → ${newState}${error ? ` (${error})` : ""}`);
}

// ── Client factory ──────────────────────────────────────────────────
function createClient(): Client {
  return new Client({
    authTimeoutMs: 0, // jangan timeout saat menunggu QR/auth
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--disable-default-apps",
        "--disable-extensions",
      ],
      headless: true,
      userDataDir: AUTH_DIR,
      executablePath: process.env.BROWSER_PATH,
      timeout: 120000,
      protocolTimeout: 300000,
    },
  });
}

let whatsAppClient: Client = createClient();

// ── Lock file cleanup ───────────────────────────────────────────────
const CHROMIUM_LOCK_FILES = [
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
];

async function removeLockFiles() {
  let removed = 0;
  const searchDirs = [AUTH_DIR, `${AUTH_DIR}/Default`];

  for (const dir of searchDirs) {
    for (const lockFile of CHROMIUM_LOCK_FILES) {
      const filePath = `${dir}/${lockFile}`;
      try {
        await fs.unlink(filePath);
        console.info(`Removed lock file: ${filePath}`);
        removed++;
      } catch (error: any) {
        if (error?.code !== "ENOENT") {
          console.warn(
            `Could not remove lock file ${filePath}:`,
            error?.message,
          );
        }
      }
    }
  }

  if (removed > 0) {
    console.info(`Cleaned up ${removed} Chromium lock file(s)`);
  } else {
    console.info("No Chromium lock files found");
  }
}

// ── Auto-reconnect helpers ──────────────────────────────────────────
function clearAutoReconnectTimer() {
  if (autoReconnectTimer) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
}

function startAutoReconnectTimer() {
  clearAutoReconnectTimer();
  autoReconnectTimer = setTimeout(async () => {
    console.warn(
      `[WA Auto-Reconnect] Client was authenticated for ${AUTO_RECONNECT_TIMEOUT_MS / 1000}s but never became ready. Reconnecting...`,
    );
    try {
      await reconnect();
    } catch (err) {
      console.error("[WA Auto-Reconnect] Failed:", err);
    }
  }, AUTO_RECONNECT_TIMEOUT_MS);
}

// ── Wire up event listeners ─────────────────────────────────────────
function attachListeners(client: Client) {
  client.once("ready", () => {
    clearAutoReconnectTimer();
    clearQr();
    setState("ready");
    console.info("WhatsApp Client is ready!");
    void applySerializedIdCompat(client).catch((err) =>
      console.warn("[WA Compat] patch on ready failed:", err),
    );
  });

  client.on("disconnected", (reason) => {
    clearAutoReconnectTimer();
    setState("disconnected", reason);
    console.warn("WhatsApp Client disconnected:", reason);
  });

  client.on("loading_screen", (percent, message) => {
    // Jangan turunkan state setelah ready — event ini bisa fire ulang saat sync
    if (clientState === "ready") return;
    setState("loading");
    console.info(`Loading WhatsApp Web: ${percent}% — ${message}`);
  });

  client.on("authenticated", () => {
    if (clientState === "ready") return;
    clearQr();
    setState("authenticated");
    console.info("WhatsApp authenticated! Waiting for ready...");
    // Mulai timer: jika dalam 3 menit tidak ready, auto-reconnect
    startAutoReconnectTimer();
  });

  client.on("auth_failure", (msg) => {
    clearAutoReconnectTimer();
    setState("error", msg);
    console.error("WhatsApp auth failure:", msg);
  });

  client.on("qr", (qr) => {
    setState("waiting_qr");
    void setQr(qr);
    console.info("QR Code received, generating...");
    qrCode.generate(qr, { small: true });
  });

  client.on("message", async (message) => {
    try {
      await client.sendSeen(message.from);
    } catch (error: any) {
      const errorMessage = error?.message || String(error) || "";
      if (errorMessage.includes("markedUnread")) {
        console.warn(
          `Warning: Could not mark message as seen for ${message.from} (chat may not be fully initialized yet)`,
        );
      } else {
        console.error(
          `Error marking message as seen for ${message.from}:`,
          error,
        );
      }
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────

/** Pertama kali dipanggil saat startup */
async function init() {
  await removeLockFiles();
  setState("initializing");
  initStartedAt = new Date();
  console.info("Initializing WhatsApp client...");

  attachListeners(whatsAppClient);
  whatsAppClient.initialize();
}

/** Logout dari WhatsApp, lalu inisialisasi client baru (perlu scan QR lagi) */
async function logoutSession(): Promise<void> {
  console.info("[WA Logout] Starting logout...");
  clearAutoReconnectTimer();
  clearQr();

  try {
    await whatsAppClient.logout();
    console.info("[WA Logout] Logged out from WhatsApp");
  } catch (err) {
    console.warn("[WA Logout] logout() failed (ignored):", err);
  }

  try {
    await whatsAppClient.destroy();
    console.info("[WA Logout] Client destroyed");
  } catch (err) {
    console.warn("[WA Logout] destroy() failed (ignored):", err);
  }

  await removeLockFiles();

  whatsAppClient = createClient();
  setState("initializing");
  initStartedAt = new Date();
  attachListeners(whatsAppClient);
  whatsAppClient.initialize();
  console.info("[WA Logout] New client initializing — scan QR at /app");
}

/** Destroy client lama dan buat + initialize ulang (tanpa restart container) */
async function reconnect(): Promise<void> {
  console.info("[WA Reconnect] Starting reconnect...");
  clearAutoReconnectTimer();
  clearQr();

  // 1. Destroy client lama (best-effort)
  try {
    await whatsAppClient.destroy();
    console.info("[WA Reconnect] Old client destroyed");
  } catch (err) {
    console.warn("[WA Reconnect] Error destroying old client (ignored):", err);
  }

  // 2. Hapus lock files sisa
  await removeLockFiles();

  // 3. Buat client baru
  whatsAppClient = createClient();
  setState("initializing");
  initStartedAt = new Date();

  // 4. Pasang listeners & initialize
  attachListeners(whatsAppClient);
  whatsAppClient.initialize();
  console.info("[WA Reconnect] New client initializing...");
}

function isReady(): boolean {
  return clientState === "ready";
}

interface ClientStatus {
  ready: boolean;
  state: ClientState;
  stateChangedAt: string;
  uptime: number; // detik sejak init
  lastError: string | null;
  message: string;
}

function getStatus(): ClientStatus {
  const uptimeMs = Date.now() - initStartedAt.getTime();

  const messages: Record<ClientState, string> = {
    initializing:
      "WhatsApp client is initializing. Please wait...",
    waiting_qr:
      "QR code generated. Scan via the web dashboard at /app or Docker logs.",
    authenticated:
      "WhatsApp authenticated, loading WhatsApp Web. Please wait...",
    loading:
      "WhatsApp Web is loading. Please wait...",
    ready:
      "WhatsApp client is ready to send messages.",
    disconnected:
      "WhatsApp client is disconnected. Use POST /whatsapp/reconnect to reconnect.",
    error:
      `WhatsApp client encountered an error: ${lastError || "unknown"}. Use POST /whatsapp/reconnect to retry.`,
  };

  return {
    ready: clientState === "ready",
    state: clientState,
    stateChangedAt: stateChangedAt.toISOString(),
    uptime: Math.round(uptimeMs / 1000),
    lastError,
    message: messages[clientState],
  };
}

interface QrInfo {
  available: boolean;
  dataUrl: string | null;
  updatedAt: string | null;
  message: string;
}

async function getQr(): Promise<QrInfo> {
  if (clientState !== "waiting_qr" || !latestQr) {
    return {
      available: false,
      dataUrl: null,
      updatedAt: qrUpdatedAt?.toISOString() ?? null,
      message:
        clientState === "waiting_qr"
          ? "Menunggu QR dari WhatsApp. Coba refresh dalam beberapa detik."
          : "QR tidak tersedia. Status saat ini tidak memerlukan scan.",
    };
  }

  const dataUrl = await QRCode.toDataURL(latestQr, {
    margin: 2,
    width: 280,
  });

  return {
    available: true,
    dataUrl,
    updatedAt: qrUpdatedAt?.toISOString() ?? null,
    message: "Scan QR dengan WhatsApp di HP: Pengaturan → Perangkat Tertaut → Tautkan perangkat.",
  };
}

export { whatsAppClient, init, reconnect, logoutSession, isReady, getStatus, getQr };
export type { ClientState, ClientStatus, QrInfo };
