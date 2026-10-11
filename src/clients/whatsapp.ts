import { promises as fs } from "fs";
import { createRequire } from "module";
import wwebjs from "whatsapp-web.js";
import type { Client as WaClient } from "whatsapp-web.js";
import qrCode from "qrcode-terminal";
import QRCode from "qrcode";
import { applySerializedIdCompat } from "@/bot/waSerializedCompat.js";
import { ensureWhatsAppStore } from "@/bot/waStore.js";

const { Client } = wwebjs;
type Client = WaClient;
const requireWwebjs = createRequire(import.meta.url);
const { LoadUtils } = requireWwebjs(
  "whatsapp-web.js/src/util/Injected/Utils.js",
) as { LoadUtils: () => void };

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

// ── Health watchdog ─────────────────────────────────────────────────
/**
 * WA Web bisa reload halaman sendiri (update versi) tanpa event `disconnected`:
 * window.Store/WWebJS hilang, tapi state tetap "ready".
 */
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;
const HEALTH_GRACE_AFTER_READY_MS = 3 * 60 * 1000;
const HEALTH_MAX_FAILURES = 2;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let healthFailures = 0;
let reconnectInProgress = false;

async function isPageHealthy(client: Client): Promise<boolean> {
  const page = (client as Client & {
    pupPage?: { evaluate: (fn: string) => Promise<unknown>; isClosed?: () => boolean };
  }).pupPage;
  if (!page || page.isClosed?.()) return false;
  try {
    const ok = await Promise.race([
      page.evaluate(
        `(() => !!(window.Store && window.Store.Msg && window.Store.Chat && window.WWebJS))()`,
      ),
      new Promise((resolve) => setTimeout(() => resolve(false), 20000)),
    ]);
    return ok === true;
  } catch {
    return false;
  }
}

async function runHealthCheck() {
  if (clientState !== "ready" || reconnectInProgress) {
    healthFailures = 0;
    return;
  }
  if (Date.now() - stateChangedAt.getTime() < HEALTH_GRACE_AFTER_READY_MS) return;

  if (await isPageHealthy(whatsAppClient)) {
    healthFailures = 0;
    return;
  }

  healthFailures++;
  console.warn(
    `[WA Health] WA Web page unhealthy (${healthFailures}/${HEALTH_MAX_FAILURES})`,
  );
  if (healthFailures < HEALTH_MAX_FAILURES) return;

  healthFailures = 0;
  console.warn("[WA Health] Store/WWebJS hilang saat state ready — auto-reconnect");
  try {
    await reconnect();
  } catch (err) {
    console.error("[WA Health] Auto-reconnect failed:", err);
  }
}

function startHealthWatchdog() {
  if (healthTimer) return;
  healthTimer = setInterval(() => {
    void runHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Fork DouglasReisofc bisa emit READY lewat force-timer TANPA attachEventListeners,
 * dan WA Web baru tidak expose Store.Call (attachEventListeners crash di
 * `Store.Call.on`). Stub Call, inject LoadUtils (window.WWebJS untuk send/getChat),
 * lalu attach.
 */
async function ensureWaMessageListeners(client: Client): Promise<void> {
  const anyClient = client as Client & {
    attachEventListeners?: () => Promise<void>;
    _eventListenersAttached?: boolean;
    pupPage?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evaluate: (pageFunction: any, ...args: unknown[]) => Promise<unknown>;
    };
  };
  if (typeof anyClient.attachEventListeners !== "function") return;

  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (anyClient._eventListenersAttached) return;

    const page = anyClient.pupPage;
    let storeProbe: Record<string, boolean> | null = null;
    if (page) {
      try {
        storeProbe = (await page.evaluate(`(() => {
          const s = window.Store;
          if (!s) return { Msg: false, Chat: false, AppState: false, Conn: false, Call: false, getChat: false };
          if (!s.Call || typeof s.Call.on !== 'function') {
            const stub = { on: function () {}, off: function () {}, getModelsArray: function () { return []; } };
            try {
              s.Call = stub;
            } catch (e) {
              try {
                Object.defineProperty(s, 'Call', { configurable: true, writable: true, value: stub });
              } catch (_) {}
            }
          }
          return {
            Msg: !!s.Msg,
            Chat: !!s.Chat,
            AppState: !!s.AppState,
            Conn: !!s.Conn,
            Call: !!(s.Call && typeof s.Call.on === 'function'),
            getChat: !!(window.WWebJS && typeof window.WWebJS.getChat === 'function')
          };
        })()`)) as Record<string, boolean>;
      } catch (err) {
        console.warn(`[WA] Store probe failed (attempt ${attempt}):`, err);
      }
    }

    const readyEnough =
      storeProbe?.Msg &&
      storeProbe?.Chat &&
      storeProbe?.AppState &&
      storeProbe?.Conn &&
      storeProbe?.Call;

    if (readyEnough && page) {
      try {
        if (!storeProbe?.getChat) {
          await page.evaluate(LoadUtils);
          console.info(`[WA] Injected WWebJS LoadUtils (attempt ${attempt})`);
        }
        await anyClient.attachEventListeners();
        if (anyClient._eventListenersAttached) {
          console.info(`[WA] Store listeners attached (attempt ${attempt})`);
          return;
        }
      } catch (err) {
        console.error(`[WA] attachEventListeners failed (attempt ${attempt}):`, err);
      }
    } else if (attempt === 1 || attempt % 5 === 0) {
      console.info(
        `[WA] waiting for Store modules (attempt ${attempt}/${maxAttempts})`,
        storeProbe,
      );
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  console.error("[WA] Gave up attaching Store listeners — reconnect may be required");
}

/**
 * WA Web baru: processMediaData mengembalikan model MediaData dengan `id` kosong.
 * WWebJS.sendMessage men-spread `mediaOptions.toJSON()` SETELAH `id: newMsgKey`,
 * sehingga id pesan tertimpa undefined → "Data passed to getter must include an id property".
 * Kembalikan objek polos tanpa `id`. Idempotent; perlu diulang setelah page reload.
 */
const MEDIA_SEND_PATCH = `(() => {
  const W = window.WWebJS;
  if (!W || typeof W.processMediaData !== 'function') return false;
  if (W.__mediaIdPatched) return true;
  const orig = W.processMediaData;
  W.processMediaData = async function (...args) {
    const m = await orig.apply(this, args);
    const j = m && typeof m.toJSON === 'function' ? m.toJSON() : { ...m };
    delete j.id;
    for (const k of Object.keys(j)) if (j[k] === undefined) delete j[k];
    return j;
  };
  W.__mediaIdPatched = true;
  return true;
})()`;

async function ensureMediaSendPatch(client: Client = whatsAppClient): Promise<boolean> {
  const page = (client as Client & {
    pupPage?: { evaluate: (fn: string) => Promise<unknown> };
  }).pupPage;
  if (!page) return false;
  try {
    return (await page.evaluate(MEDIA_SEND_PATCH)) === true;
  } catch (err) {
    console.warn("[WA] media send patch failed:", err);
    return false;
  }
}

// ── Wire up event listeners ─────────────────────────────────────────
function attachListeners(client: Client) {
  client.once("ready", () => {
    clearAutoReconnectTimer();
    clearQr();
    // Must finish store heal + compat patch BEFORE advertising ready.
    void (async () => {
      await ensureWaMessageListeners(client);
      try {
        const health = await ensureWhatsAppStore(client, { retries: 20, delayMs: 1000 });
        if (!health.ok) {
          console.warn("[WA Store] Ready event but WidFactory missing — marking error");
          setState(
            "error",
            "WhatsApp Store.WidFactory unavailable. Coba POST /whatsapp/reconnect.",
          );
          return;
        }
        await applySerializedIdCompat(client);
      } catch (err) {
        console.warn("[WA Compat] patch on ready failed:", err);
      }
      await ensureMediaSendPatch(client);
      setState("ready");
      console.info("WhatsApp Client is ready! (compat=on)");
    })();
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
  startHealthWatchdog();
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
  if (reconnectInProgress) {
    console.info("[WA Reconnect] Already in progress, skipped");
    return;
  }
  reconnectInProgress = true;
  try {
    await doReconnect();
  } finally {
    reconnectInProgress = false;
  }
}

async function doReconnect(): Promise<void> {
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

export {
  whatsAppClient,
  init,
  reconnect,
  logoutSession,
  isReady,
  getStatus,
  getQr,
  ensureMediaSendPatch,
};
export type { ClientState, ClientStatus, QrInfo };
