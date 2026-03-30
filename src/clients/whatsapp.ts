import { promises as fs } from "fs";
import { Client } from "whatsapp-web.js";
import qrCode from "qrcode-terminal";

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
    setState("ready");
    console.info("WhatsApp Client is ready!");
  });

  client.on("disconnected", (reason) => {
    clearAutoReconnectTimer();
    setState("disconnected", reason);
    console.warn("WhatsApp Client disconnected:", reason);
  });

  client.on("loading_screen", (percent, message) => {
    setState("loading");
    console.info(`Loading WhatsApp Web: ${percent}% — ${message}`);
  });

  client.on("authenticated", () => {
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

/** Destroy client lama dan buat + initialize ulang (tanpa restart container) */
async function reconnect(): Promise<void> {
  console.info("[WA Reconnect] Starting reconnect...");
  clearAutoReconnectTimer();

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
      "QR code generated. Please scan the QR code from Docker logs to connect.",
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

export { whatsAppClient, init, reconnect, isReady, getStatus };
export type { ClientState, ClientStatus };
