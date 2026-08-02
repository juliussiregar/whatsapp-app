#!/usr/bin/env node
/**
 * Patch whatsapp-web.js for WhatsApp Web's `_serialized` → `$1` rename (2026).
 * Safe to run multiple times (idempotent).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const utilsPath = join(
  root,
  "node_modules/whatsapp-web.js/src/util/Injected/Utils.js",
);
const contactPath = join(
  root,
  "node_modules/whatsapp-web.js/src/structures/Contact.js",
);
const clientPath = join(
  root,
  "node_modules/whatsapp-web.js/src/Client.js",
);

function patchFile(path, replacements, label, { force = false } = {}) {
  if (!existsSync(path)) {
    console.warn(`[patch-wwebjs] Skip ${label}: not found at ${path}`);
    return false;
  }
  let src = readFileSync(path, "utf8");
  const already = src.includes("__WWEBJS_SERIALIZED_COMPAT__");
  if (already && !force) {
    // Still apply any missing replacements (for incremental patch updates).
  }
  let changed = 0;
  for (const [from, to] of replacements) {
    if (src.includes(to) && !src.includes(from)) continue;
    if (!src.includes(from)) continue;
    const next = src.split(from).join(to);
    if (next !== src) {
      changed += src.split(from).length - 1;
      src = next;
    }
  }
  if (!changed) {
    if (already) {
      console.info(`[patch-wwebjs] ${label} already patched`);
      return false;
    }
    console.warn(`[patch-wwebjs] ${label}: no target strings found (library may have changed)`);
    return false;
  }
  if (!src.includes("__WWEBJS_SERIALIZED_COMPAT__")) {
    src = `/* __WWEBJS_SERIALIZED_COMPAT__ */\n` + src;
  }
  writeFileSync(path, src);
  console.info(`[patch-wwebjs] Patched ${label} (${changed} replacement(s))`);
  return true;
}

const utilsReplacements = [
  [
    "return window.Store.Msg.get(newMsgKey._serialized);",
    "return window.Store.Msg.get(newMsgKey._serialized || newMsgKey.$1);",
  ],
  [
    "return window.Store.Msg.get(msg.id._serialized);",
    "return window.Store.Msg.get(msg.id._serialized || msg.id.$1);",
  ],
  [
    "msg.id = Object.assign({}, msg.id, { remote: msg.id.remote._serialized });",
    "msg.id = Object.assign({}, msg.id, { remote: msg.id.remote._serialized || msg.id.remote.$1 });\n        if (msg.id && msg.id._serialized == null && msg.id.$1 != null) {\n            msg.id = Object.assign({}, msg.id, { _serialized: msg.id.$1 });\n        }",
  ],
  [
    "const chatWid = window.Store.WidFactory.createWid(chat.id._serialized);",
    "const chatWid = window.Store.WidFactory.createWid(chat.id._serialized || chat.id.$1);",
  ],
  [
    "filter(x => x.id?._serialized?.endsWith('@lid'))",
    "filter(x => (x.id?._serialized || x.id?.$1)?.endsWith('@lid'))",
  ],
  [
    "? window.Store.Msg.get(chat.lastReceivedKey._serialized) || (await window.Store.Msg.getMessagesById([chat.lastReceivedKey._serialized]))?.messages?.[0]",
    "? window.Store.Msg.get(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1) || (await window.Store.Msg.getMessagesById([chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1]))?.messages?.[0]",
  ],
  [
    "if (contact.id._serialized.endsWith('@lid')) {",
    "if ((contact.id._serialized || contact.id.$1 || '').endsWith('@lid')) {",
  ],
];

const contactReplacements = [
  [
    "return await this.client.getChatById(this.id._serialized);",
    "return await this.client.getChatById(this.id._serialized || this.id.$1);",
  ],
];

const clientReplacements = [
  [
    `return {
                    lid: lid?._serialized,
                    pn: phone?._serialized
                };`,
    `return {
                    lid: lid?._serialized || lid?.$1,
                    pn: phone?._serialized || phone?.$1
                };`,
  ],
];

let any = false;
any = patchFile(utilsPath, utilsReplacements, "Injected/Utils.js") || any;
any = patchFile(contactPath, contactReplacements, "Contact.js") || any;
any = patchFile(clientPath, clientReplacements, "Client.js") || any;
if (!any) {
  console.info("[patch-wwebjs] Nothing new to apply");
}
