import { exec } from "child_process";
import { promisify } from "util";
import { Client } from "whatsapp-web.js";
const execAsync = promisify(exec);
import qrCode from "qrcode-terminal";

const whatsAppClient = new Client({
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
    userDataDir: "./.wwebjs_auth",
    executablePath: process.env.BROWSER_PATH,
  },
});

interface MessageToSend {
  to: string;
  message: string;
}

async function cleanupBrowserProcesses() {
  try {
    // Kill any existing Chrome/Chromium processes
    await execAsync('pkill -f "chromium.*wwebjs_auth" || true');
    console.info("Cleaned up existing browser processes");
  } catch (error) {
    console.info("No browser processes to clean up");
  }
}


async function init() {
  // Clean up any existing browser processes and lock files
  await cleanupBrowserProcesses();

  // When the client is ready, run this code (only once)
  whatsAppClient.once("ready", async () => {
    console.info("WhatsApp Client is ready!");
  });

  // When the client received QR-Code
  whatsAppClient.on("qr", async (qr) => {
    console.info("QR Code received, generating...");
    qrCode.generate(qr, { small: true });
  });

  // When the message is comming
  whatsAppClient.on("message", async (message) => {
    try {
      // Coba mark as seen, tapi tangani error jika chat belum ada
      await whatsAppClient.sendSeen(message.from);
    } catch (error: any) {
      // Error markedUnread terjadi jika chat belum ada atau belum fully initialized
      // Ini tidak critical, pesan tetap diterima
      const errorMessage = error?.message || String(error) || '';
      if (errorMessage.includes('markedUnread')) {
        console.warn(`Warning: Could not mark message as seen for ${message.from} (chat may not be fully initialized yet)`);
      } else {
        // Log error lain untuk debugging
        console.error(`Error marking message as seen for ${message.from}:`, error);
      }
    }
  });

  whatsAppClient.initialize();
}

export { whatsAppClient, init };
