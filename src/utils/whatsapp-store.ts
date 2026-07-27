import { whatsAppClient } from "@/clients/whatsapp.js";
// Plain JS — avoids tsx/esbuild __name helper breaking Puppeteer evaluate
import fetchMessagesInBrowser from "../injected/fetch-messages.browser.js";
import fetchGroupsInBrowser from "../injected/fetch-groups.browser.js";
import downloadMessageMediaInBrowser from "../injected/download-message-media.browser.js";
import downloadLatestChatImageInBrowser from "../injected/download-latest-chat-image.browser.js";

export type ChatFilter = "all" | "personal" | "group";

export interface ChatListItem {
  id: string;
  name: string;
  isGroup: boolean;
  participantsCount: number;
  botIsMember?: boolean;
  unreadCount: number;
  timestamp: number | null;
  lastMessage: { body: string; fromMe: boolean; timestamp: number } | null;
}

export interface StoreMessage {
  id: string;
  body: string;
  fromMe: boolean;
  author: string | null;
  timestamp: number;
  type: string;
  hasMedia: boolean;
  mimetype: string | null;
  filename: string | null;
}

const MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "ptt",
  "document",
  "sticker",
]);

/** WhatsApp Web sometimes puts JPEG/base64 in `body` for image messages. */
export function isMediaPayloadBody(body: string): boolean {
  if (!body?.trim()) return false;
  const s = body.trim();
  if (s.length < 80) return false;
  if (s.startsWith("/9j/")) return true;
  if (s.startsWith("iVBORw0KGgo")) return true;
  if (s.startsWith("data:image/") || s.startsWith("data:video/")) return true;
  if (s.length > 400 && /^[A-Za-z0-9+/=]+$/.test(s)) return true;
  return false;
}

export function resolveMessageDisplayBody(
  body: string | undefined,
  caption: string | undefined,
  type: string,
  hasMedia: boolean,
): string {
  const cap = (caption || "").trim();
  const raw = (body || "").trim();
  if (hasMedia || MEDIA_TYPES.has(type)) {
    if (cap && !isMediaPayloadBody(cap)) return cap;
    if (raw && !isMediaPayloadBody(raw)) return raw;
    return "";
  }
  if (raw && isMediaPayloadBody(raw)) return "";
  return raw;
}

function normalizeAuthor(author: unknown): string | null {
  if (author == null) return null;
  if (typeof author === "string") return author;
  if (typeof author === "object") {
    const a = author as {
      _serialized?: string;
      user?: string;
      server?: string;
    };
    if (a._serialized) return a._serialized;
    if (a.user && a.server) return `${a.user}@${a.server}`;
  }
  const s = String(author);
  return s === "[object Object]" ? null : s;
}

const SKIP_MESSAGE_TYPES = new Set([
  "e2e_notification",
  "gp2",
  "notification",
  "protocol",
  "ciphertext",
  "revoked",
  "poll_creation",
  "unknown",
  "group_notification",
  "call_log",
]);

function isDisplayableStoreMessage(m: StoreMessage): boolean {
  if (SKIP_MESSAGE_TYPES.has(m.type)) return false;
  if (m.hasMedia) return true;
  const body = resolveMessageDisplayBody(m.body, undefined, m.type, m.hasMedia);
  return m.type === "chat" && Boolean(body.trim());
}

function sanitizeStoreMessage(m: StoreMessage): StoreMessage {
  let author = normalizeAuthor(m.author);
  if (author?.includes("@g.us")) author = null;
  return {
    ...m,
    author,
    body: resolveMessageDisplayBody(m.body, undefined, m.type, m.hasMedia),
  };
}

function formatMessageBody(msg: {
  body?: string;
  caption?: string;
  type?: string;
  hasMedia?: boolean;
}): string {
  const type = msg?.type || "chat";
  const hasMedia = Boolean(msg?.hasMedia) || MEDIA_TYPES.has(type);
  const display = resolveMessageDisplayBody(
    msg?.body,
    msg?.caption,
    type,
    hasMedia,
  );
  if (display) return display;
  const labels: Record<string, string> = {
    image: "[Gambar]",
    video: "[Video]",
    audio: "[Audio]",
    ptt: "[Voice note]",
    document: "[Dokumen]",
    sticker: "[Stiker]",
    location: "[Lokasi]",
    contact_card: "[Kontak]",
    poll: "[Poll]",
  };
  return labels[msg?.type || ""] || `[${msg?.type || "Media"}]`;
}

function getPupPage() {
  const page = (whatsAppClient as { pupPage?: unknown }).pupPage;
  if (!page) throw new Error("WhatsApp client page not available");
  return page as {
    evaluate: <T>(fn: (...args: unknown[]) => T, ...args: unknown[]) => Promise<T>;
  };
}

/** Serialize Puppeteer store reads — concurrent evaluate() calls race and destroy context. */
let storeOpChain: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeOpChain.then(fn, fn);
  storeOpChain = run.catch(() => undefined);
  return run;
}

function mapChatModel(chat: {
  id?: { _serialized?: string };
  name?: string;
  isGroup?: boolean;
  participants?: unknown[];
  unreadCount?: number;
  timestamp?: number;
  lastMessage?: {
    body?: string;
    type?: string;
    fromMe?: boolean;
    timestamp?: number;
  };
}): ChatListItem | null {
  try {
    const rawId = chat.id as
      | { _serialized?: string; user?: string; server?: string }
      | undefined;
    const id =
      rawId?._serialized ||
      (rawId?.user && rawId?.server ? `${rawId.user}@${rawId.server}` : undefined);
    if (!id) return null;

    const isGroup = Boolean(chat.isGroup) || id.endsWith("@g.us");
    const lastMsg = chat.lastMessage;

    return {
      id,
      name: chat.name || id,
      isGroup,
      participantsCount: Array.isArray(chat.participants)
        ? chat.participants.length
        : 0,
      unreadCount: chat.unreadCount || 0,
      timestamp: chat.timestamp || lastMsg?.timestamp || null,
      lastMessage: lastMsg
        ? {
            body: formatMessageBody({
              body: lastMsg.body,
              caption: (lastMsg as { caption?: string }).caption,
              type: lastMsg.type,
              hasMedia: MEDIA_TYPES.has(lastMsg.type || ""),
            }),
            fromMe: Boolean(lastMsg.fromMe),
            timestamp: lastMsg.timestamp || 0,
          }
        : null,
    };
  } catch {
    return null;
  }
}

async function fetchChatsViaClient(): Promise<ChatListItem[]> {
  const allChats = await whatsAppClient.getChats();
  return allChats
    .map((c) => mapChatModel(c as Parameters<typeof mapChatModel>[0]))
    .filter((c): c is ChatListItem => c !== null);
}

async function fetchChatsViaStoreEvaluate(): Promise<ChatListItem[]> {
  const pupPage = getPupPage();
  const raw = await pupPage.evaluate(() => {
    // @ts-ignore — runs in browser
    const store = window.Store;
    if (!store?.Chat?.getModelsArray) return [];
    const chats = store.Chat.getModelsArray();
    const items: {
      id: string;
      name: string;
      isGroup: boolean;
      participantsCount: number;
      unreadCount: number;
      timestamp: number | null;
      lastMessage: { body: string; fromMe: boolean; timestamp: number } | null;
    }[] = [];

    for (const chat of chats) {
      try {
        let id = chat.id?._serialized;
        if (!id && chat.id?.user && chat.id?.server) {
          id = `${chat.id.user}@${chat.id.server}`;
        }
        if (!id || typeof id !== "string") continue;
        if (id.includes("@broadcast")) continue;

        // @ts-ignore
        const store = window.Store;
        const isNewsletter =
          store.ChatGetters?.getIsNewsletter?.(chat) || id.includes("@newsletter");
        if (isNewsletter) continue;

        const isGroup =
          id.endsWith("@g.us") ||
          Boolean(chat.groupMetadata) ||
          (typeof chat.id?.isGroup === "function" && chat.id.isGroup());

        const name =
          chat.name ||
          chat.formattedTitle ||
          chat.contact?.formattedName ||
          chat.contact?.pushname ||
          id;

        let participantsCount = 0;
        if (isGroup && chat.groupMetadata?.participants) {
          const p = chat.groupMetadata.participants;
          participantsCount =
            p._models?.length || (Array.isArray(p) ? p.length : 0);
        }

        const lm = chat.lastMessage || chat.msgs?.last?.();
        let lastMessage = null;
        if (lm) {
          const type = lm.type || "chat";
          const hasMedia =
            Boolean(lm.directPath) ||
            MEDIA_TYPES.has(type);
          const body = formatMessageBody({
            body: lm.body,
            caption: lm.caption,
            type,
            hasMedia,
          });
          lastMessage = {
            body,
            fromMe: Boolean(lm.id?.fromMe ?? lm.fromMe),
            timestamp: lm.t || lm.timestamp || 0,
          };
        }

        items.push({
          id,
          name,
          isGroup,
          participantsCount,
          unreadCount: chat.unreadCount || 0,
          timestamp: chat.t || chat.timestamp || lastMessage?.timestamp || null,
          lastMessage,
        });
      } catch {
        continue;
      }
    }
    return items;
  });

  return Array.isArray(raw) ? raw : [];
}

async function fetchGroupsViaStoreDedicated(): Promise<ChatListItem[]> {
  try {
    const pupPage = getPupPage();
    const raw = await pupPage.evaluate(
      fetchGroupsInBrowser as (...args: unknown[]) => ChatListItem[],
    );
    const list = Array.isArray(raw) ? raw : [];
    console.info(`[WA Store] fetchGroups script: ${list.length} groups`);
    return list;
  } catch (err) {
    console.warn("[WA Store] fetchGroups script failed:", err);
    return [];
  }
}

function mergeChats(primary: ChatListItem[], secondary: ChatListItem[]): ChatListItem[] {
  const map = new Map<string, ChatListItem>();
  for (const c of [...primary, ...secondary]) {
    const existing = map.get(c.id);
    if (!existing) {
      map.set(c.id, c);
      continue;
    }
    map.set(c.id, {
      ...existing,
      name: existing.name !== existing.id ? existing.name : c.name,
      isGroup: existing.isGroup || c.isGroup,
      participantsCount: Math.max(
        existing.participantsCount,
        c.participantsCount,
      ),
      botIsMember: existing.botIsMember || c.botIsMember,
      lastMessage: existing.lastMessage || c.lastMessage,
      timestamp: existing.timestamp || c.timestamp,
    });
  }
  return [...map.values()];
}

export async function fetchChatsFromStore(
  filter: ChatFilter,
): Promise<ChatListItem[]> {
  return withStoreLock(async () => {
    let fromClient: ChatListItem[] = [];
    let fromStore: ChatListItem[] = [];

    try {
      fromClient = await fetchChatsViaClient();
      console.info(`[WA Store] getChats(): ${fromClient.length} chats`);
    } catch (err) {
      console.warn("[WA Store] getChats() failed:", err);
    }

    try {
      fromStore = await fetchChatsViaStoreEvaluate();
      console.info(`[WA Store] Store evaluate: ${fromStore.length} chats`);
    } catch (err) {
      console.warn("[WA Store] Store evaluate failed:", err);
    }

    let chats = mergeChats(fromClient, fromStore);

    if (filter === "group" || filter === "all") {
      const fromGroups = await fetchGroupsViaStoreDedicated();
      chats = mergeChats(chats, fromGroups);
    }

    chats = chats.map((c) => ({
      ...c,
      isGroup: c.isGroup || c.id.endsWith("@g.us"),
    }));

    if (filter === "group") {
      chats = chats.filter((c) => c.isGroup || c.id.endsWith("@g.us"));
      chats = chats.filter((c) => c.participantsCount > 0);
    }
    if (filter === "personal") {
      chats = chats.filter((c) => !c.isGroup && !c.id.includes("@broadcast"));
    }

    if (chats.length === 0) {
      if (filter === "group") {
        throw new Error(
          "Tidak ada grup ditemukan. Buka daftar grup di WhatsApp HP, scroll sedikit, tunggu 10 detik, lalu klik ↻ di dashboard.",
        );
      }
      throw new Error(
        "Tidak ada chat ditemukan. Pastikan WhatsApp sudah ready dan ada riwayat chat.",
      );
    }

    chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return chats;
  });
}

export async function fetchMessagesFromStore(
  chatId: string,
  limit: number,
): Promise<{
  ok: boolean;
  chatName: string | null;
  isGroup: boolean;
  messages: StoreMessage[];
  loadedCount: number;
}> {
  return withStoreLock(async () => {
    try {
      await Promise.race([
        whatsAppClient.syncHistory(chatId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("syncHistory timeout")), 15000),
        ),
      ]);
      console.info(`[WA Store] syncHistory ok for ${chatId}`);
    } catch (err) {
      console.warn(`[WA Store] syncHistory skipped for ${chatId}:`, err);
    }

    const pupPage = getPupPage();
    const result = await pupPage.evaluate(
      fetchMessagesInBrowser as (...args: unknown[]) => ReturnType<
        typeof fetchMessagesFromStore
      >,
      chatId,
      limit,
    );

    const typed = result as Awaited<ReturnType<typeof fetchMessagesFromStore>>;
    if (typed.messages?.length) {
      typed.messages = typed.messages
        .map(sanitizeStoreMessage)
        .filter(isDisplayableStoreMessage);
      typed.loadedCount = typed.messages.length;
    }
    return typed;
  });
}

export interface MessageMediaResult {
  ok: boolean;
  mimetype?: string;
  filename?: string | null;
  filesize?: number | null;
  data?: string;
  dataUrl?: string;
  type?: string;
  error?: string;
}

export async function downloadMessageMediaFromStore(
  messageId: string,
): Promise<MessageMediaResult> {
  return withStoreLock(async () => {
    const pupPage = getPupPage();
    const raw = (await pupPage.evaluate(
      downloadMessageMediaInBrowser as (...args: unknown[]) => unknown,
      messageId,
    )) as MessageMediaResult;

    if (raw.ok && raw.data && raw.mimetype) {
      return {
        ...raw,
        dataUrl: `data:${raw.mimetype};base64,${raw.data}`,
      };
    }

    return raw;
  });
}

export async function downloadLatestChatImageFromStore(
  chatId: string,
  aroundTimestamp?: number | null,
): Promise<MessageMediaResult> {
  return withStoreLock(async () => {
    const pupPage = getPupPage();
    const raw = (await pupPage.evaluate(
      downloadLatestChatImageInBrowser as (...args: unknown[]) => unknown,
      chatId,
      aroundTimestamp ?? null,
    )) as MessageMediaResult;

    if (raw.ok && raw.data && raw.mimetype) {
      return {
        ...raw,
        dataUrl: `data:${raw.mimetype};base64,${raw.data}`,
      };
    }

    return raw;
  });
}
