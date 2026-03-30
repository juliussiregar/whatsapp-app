import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { whatsAppClient, isReady, reconnect, getStatus } from '@/clients/whatsapp.js'
import whatsappWeb from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  ErrorSchema,
  StatusSchema,
  ReconnectResponseSchema,
  SendMessageBodySchema,
  SendMessageResponseSchema,
  SendImageBodySchema,
  SendImageResponseSchema,
  GroupsResponseSchema,
  SendGroupMessageBodySchema,
  SendGroupMessageResponseSchema,
  SendGroupImageBodySchema,
  SendGroupImageResponseSchema,
  LogoutResponseSchema,
  AuthClearResponseSchema,
  CacheClearResponseSchema,
  ResetResponseSchema,
} from '@/schemas/whatsapp.js'

const { MessageMedia } = whatsappWeb
const execAsync = promisify(exec)

const whatsapp = new OpenAPIHono()

// ── Helper functions ────────────────────────────────────────────────

function formatPhoneNumber(phoneNumber: string): string {
  let formatted = phoneNumber.trim().replaceAll(/\D/g, '')
  if (formatted.startsWith('0')) {
    formatted = '62' + formatted.substring(1)
  } else if (!formatted.startsWith('62') && formatted.length <= 10) {
    formatted = '62' + formatted
  }
  return formatted
}

async function getValidatedContact(formattedPhone: string) {
  const numberId = await whatsAppClient.getNumberId(formattedPhone)
  if (!numberId) {
    throw new Error(`Phone number ${formattedPhone} is not registered on WhatsApp`)
  }
  const contactId = numberId._serialized
  const contact = await whatsAppClient.getContactById(contactId)
  if (!contact) {
    throw new Error(`Unable to get contact for ${formattedPhone}`)
  }
  return { contactId, contact }
}

async function sendMessageSafely(contactId: string, content: any, options: any = {}) {
  const contact = await whatsAppClient.getContactById(contactId)
  if (!contact) {
    throw new Error('Contact not found')
  }
  let chat = await contact.getChat()
  if (chat) {
    const verifiedChat = await whatsAppClient.getChatById(chat.id._serialized)
    if (verifiedChat) {
      await verifiedChat.sendMessage(content, { ...options, sendSeen: false })
    } else {
      await whatsAppClient.sendMessage(contactId, content, { ...options, sendSeen: false })
    }
  } else {
    await whatsAppClient.sendMessage(contactId, content, { ...options, sendSeen: false })
  }
}

async function getGroupChat(groupId?: string, groupName?: string) {
  let groupChat: any = null

  if (groupId) {
    console.log(`Getting group by ID: ${groupId}`)
    try {
      groupChat = await whatsAppClient.getChatById(groupId)
      if (groupChat && groupChat.isGroup) return groupChat
      if (groupChat && !groupChat.isGroup) throw new Error(`Chat with ID ${groupId} is not a group`)
    } catch (error) {
      console.warn(`getChatById failed for ${groupId}, trying getChats() fallback:`, error)
    }
    throw new Error(`Cannot get group with ID ${groupId}. Try using sendMessage directly with groupId instead.`)
  } else if (groupName) {
    console.log(`Searching for group by name: ${groupName}`)
    const pupPage = (whatsAppClient as any).pupPage
    if (!pupPage) throw new Error('WhatsApp client page not available')

    try {
      const result = await pupPage.evaluate((searchName: string) => {
        try {
          // @ts-ignore
          const chats = window.Store.Chat.getModelsArray()
          for (const chat of chats) {
            try {
              // @ts-ignore
              const store = window.Store
              const hasGroupMetadata = chat.groupMetadata !== undefined && chat.groupMetadata !== null
              const isGroupId = typeof chat.id?.isGroup === 'function' ? chat.id.isGroup() : false
              const isGroupIdString = chat.id?._serialized?.endsWith('@g.us') || false
              const isNewsletter = store.ChatGetters?.getIsNewsletter?.(chat) || false
              const isGroup = (hasGroupMetadata || isGroupId || isGroupIdString) && !isNewsletter
              if (isGroup) {
                const name = chat.name || chat.formattedTitle || chat.contact?.formattedName || ''
                if (name.toLowerCase() === searchName.toLowerCase()) {
                  return { id: chat.id?._serialized || chat.id?.user || chat.id, name }
                }
              }
            } catch { continue }
          }
          return null
        } catch (error) { throw error }
      }, groupName)

      if (!result || !result.id) {
        throw new Error(`Group with name "${groupName}" not found. Make sure the group name is correct and you're still in the group.`)
      }
      return {
        id: { _serialized: result.id },
        name: result.name,
        isGroup: true,
        sendMessage: async (content: any, options: any = {}) => {
          return await whatsAppClient.sendMessage(result.id, content, options)
        },
      }
    } catch (error: any) {
      throw new Error(`Failed to find group "${groupName}": ${error?.message || String(error)}`)
    }
  }
  return groupChat
}

// ── Routes ──────────────────────────────────────────────────────────

// GET /status
const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['WhatsApp - Status'],
  summary: 'Cek Status Client (Detail)',
  description:
    'Mengecek status detail WhatsApp client termasuk state, uptime, dan error terakhir. State: `initializing`, `waiting_qr`, `authenticated`, `loading`, `ready`, `disconnected`, `error`.',
  responses: {
    200: {
      content: { 'application/json': { schema: StatusSchema } },
      description: 'Status detail client WhatsApp',
    },
  },
})

whatsapp.openapi(statusRoute, (c) => {
  return c.json(getStatus(), 200)
})

// POST /reconnect
const reconnectRoute = createRoute({
  method: 'post',
  path: '/reconnect',
  tags: ['WhatsApp - Status'],
  summary: 'Reconnect Client',
  description:
    'Menghancurkan client WhatsApp yang sedang berjalan dan membuat client baru tanpa perlu restart Docker container. Auto-reconnect juga aktif jika stuck di `authenticated` > 3 menit.',
  responses: {
    200: {
      content: { 'application/json': { schema: ReconnectResponseSchema } },
      description: 'Reconnect berhasil dimulai',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal reconnect',
    },
  },
})

whatsapp.openapi(reconnectRoute, async (c) => {
  try {
    console.log('Reconnect requested via API...')
    await reconnect()
    return c.json(
      {
        success: true,
        message: 'WhatsApp client is reconnecting. Check /whatsapp/status for progress.',
        note: 'If a QR code is needed, check Docker logs.',
      },
      200,
    )
  } catch (error) {
    console.error('Error reconnecting:', error)
    return c.json(
      { success: false, error: 'Failed to reconnect', details: error instanceof Error ? error.message : String(error) },
      500,
    )
  }
})

// POST /send-message
const sendMessageRoute = createRoute({
  method: 'post',
  path: '/send-message',
  tags: ['WhatsApp - Personal'],
  summary: 'Kirim Pesan Teks',
  description: 'Mengirim pesan teks ke nomor WhatsApp pribadi. Nomor akan divalidasi apakah terdaftar di WhatsApp sebelum dikirim.',
  request: {
    body: { content: { 'application/json': { schema: SendMessageBodySchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SendMessageResponseSchema } },
      description: 'Pesan berhasil dikirim',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Request tidak valid',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal mengirim pesan',
    },
  },
})

whatsapp.openapi(sendMessageRoute, async (c) => {
  try {
    const { phoneNumber, message } = c.req.valid('json')
    if (!phoneNumber || !message) {
      return c.json({ success: false, error: 'Phone number and message are required' }, 400)
    }
    const formattedPhone = formatPhoneNumber(phoneNumber)
    const { contactId } = await getValidatedContact(formattedPhone)
    await sendMessageSafely(contactId, message)
    return c.json({ success: true, message: 'Message sent successfully', to: formattedPhone }, 200)
  } catch (error) {
    console.error('Error sending WhatsApp message:', error)
    return c.json(
      { success: false, error: 'Failed to send message', details: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
      500,
    )
  }
})

// POST /send-image
const sendImageRoute = createRoute({
  method: 'post',
  path: '/send-image',
  tags: ['WhatsApp - Personal'],
  summary: 'Kirim Gambar',
  description: 'Mengirim gambar ke nomor WhatsApp pribadi. Gambar bisa berupa URL atau path file lokal di dalam container Docker.',
  request: {
    body: { content: { 'application/json': { schema: SendImageBodySchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SendImageResponseSchema } },
      description: 'Gambar berhasil dikirim',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Request tidak valid',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal mengirim gambar',
    },
  },
})

whatsapp.openapi(sendImageRoute, async (c) => {
  try {
    const { phoneNumber, image, message } = c.req.valid('json')
    if (!phoneNumber || !image) {
      return c.json({ success: false, error: 'Phone number and image are required', details: 'Image can be a file path (local) or URL' }, 400)
    }
    const formattedPhone = formatPhoneNumber(phoneNumber)
    const { contactId } = await getValidatedContact(formattedPhone)

    let media: any
    if (image.startsWith('http://') || image.startsWith('https://')) {
      console.log(`Loading image from URL: ${image}`)
      media = await MessageMedia.fromUrl(image)
    } else {
      console.log(`Loading image from file: ${image}`)
      media = MessageMedia.fromFilePath(image)
    }

    const options: any = { sendSeen: false }
    if (message) options.caption = message

    await sendMessageSafely(contactId, media, options)
    return c.json({ success: true, message: 'Image sent successfully', to: formattedPhone, caption: message || null }, 200)
  } catch (error) {
    console.error('Error sending WhatsApp image:', error)
    return c.json(
      { success: false, error: 'Failed to send image', details: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
      500,
    )
  }
})

// GET /groups
const groupsRoute = createRoute({
  method: 'get',
  path: '/groups',
  tags: ['WhatsApp - Group'],
  summary: 'Daftar Grup',
  description: 'Mendapatkan daftar semua grup WhatsApp yang diikuti. Gunakan `id` dari response untuk endpoint send-group-message dan send-group-image.',
  responses: {
    200: {
      content: { 'application/json': { schema: GroupsResponseSchema } },
      description: 'Daftar grup berhasil didapatkan',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal mendapatkan daftar grup',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'WhatsApp client belum siap',
    },
  },
})

whatsapp.openapi(groupsRoute, async (c) => {
  try {
    let groups: any[] = []
    let retries = 3
    let lastError: any = null

    const pupPage = (whatsAppClient as any).pupPage
    if (!pupPage) {
      return c.json(
        { success: false, error: 'WhatsApp client page not available', details: 'The browser page is not initialized yet. Please wait for the client to be ready.' },
        503,
      )
    }

    while (retries > 0) {
      try {
        const rawChats = await pupPage.evaluate(() => {
          try {
            // @ts-ignore
            const chats = window.Store.Chat.getModelsArray()
            const groups: any[] = []
            let totalChats = chats.length
            let groupCount = 0
            for (const chat of chats) {
              try {
                // @ts-ignore
                const store = window.Store
                const hasGroupMetadata = chat.groupMetadata !== undefined && chat.groupMetadata !== null
                const isGroupId = typeof chat.id?.isGroup === 'function' ? chat.id.isGroup() : false
                const isGroupIdString = chat.id?._serialized?.endsWith('@g.us') || false
                const isNewsletter = store.ChatGetters?.getIsNewsletter?.(chat) || false
                const isGroup = (hasGroupMetadata || isGroupId || isGroupIdString) && !isNewsletter
                if (isGroup) {
                  groupCount++
                  const chatId = chat.id?._serialized || chat.id?.user || chat.id
                  const name = chat.name || chat.formattedTitle || chat.contact?.formattedName || 'Unknown'
                  let participantsCount = 0
                  if (chat.groupMetadata && chat.groupMetadata.participants) {
                    const participants = chat.groupMetadata.participants
                    if (participants._models) participantsCount = participants._models.length
                    else if (Array.isArray(participants)) participantsCount = participants.length
                  }
                  groups.push({ id: chatId, name, participantsCount })
                }
              } catch { continue }
            }
            return { groups, debug: { totalChats, groupCount } }
          } catch (error) { throw error }
        })

        if (rawChats && typeof rawChats === 'object' && 'groups' in rawChats) {
          groups = rawChats.groups || []
          if (rawChats.debug) console.log(`Debug: Total chats: ${rawChats.debug.totalChats}, Groups found: ${rawChats.debug.groupCount}`)
        } else {
          groups = Array.isArray(rawChats) ? rawChats : []
        }
        console.log(`Found ${groups.length} groups using direct Store.Chat access`)
        break
      } catch (error: any) {
        lastError = error
        retries--
        console.warn(`getChats() alternative method failed (attempt ${3 - retries}/3):`, error?.message || String(error))
        if (retries > 0) await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }

    if (groups.length === 0 && lastError) {
      console.log('Trying fallback to standard getChats() method...')
      try {
        const chats = await whatsAppClient.getChats()
        groups = chats
          .filter((chat: any) => { try { return chat && chat.isGroup === true } catch { return false } })
          .map((chat: any) => { try { return { id: chat.id?._serialized || chat.id || 'unknown', name: chat.name || 'Unknown', participantsCount: chat.participants?.length || 0 } } catch { return null } })
          .filter((group: any) => group !== null)
      } catch {
        return c.json(
          {
            success: false,
            error: 'Failed to get groups due to internal WhatsApp Web state issue',
            details: lastError?.message || String(lastError),
          },
          500,
        )
      }
    }

    return c.json({ success: true, groups, total: groups.length }, 200)
  } catch (error) {
    console.error('Error getting groups:', error)
    return c.json(
      { success: false, error: 'Failed to get groups', details: error instanceof Error ? error.message : String(error) },
      500,
    )
  }
})

// POST /send-group-message
const sendGroupMessageRoute = createRoute({
  method: 'post',
  path: '/send-group-message',
  tags: ['WhatsApp - Group'],
  summary: 'Kirim Pesan ke Grup',
  description: 'Mengirim pesan teks ke grup WhatsApp. Bisa menggunakan **groupId** (direkomendasikan) atau **groupName**.',
  request: {
    body: { content: { 'application/json': { schema: SendGroupMessageBodySchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SendGroupMessageResponseSchema } },
      description: 'Pesan berhasil dikirim ke grup',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Request tidak valid',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal mengirim pesan ke grup',
    },
  },
})

whatsapp.openapi(sendGroupMessageRoute, async (c) => {
  try {
    const { groupId, groupName, message } = c.req.valid('json')
    if (!message) return c.json({ success: false, error: 'Message is required' }, 400)
    if (!groupId && !groupName) {
      return c.json({ success: false, error: 'Either groupId or groupName is required', details: 'groupId format: 123456789@g.us or groupName: name of the group' }, 400)
    }

    if (groupId) {
      if (!groupId.includes('@g.us')) {
        return c.json({ success: false, error: 'Invalid group ID format', details: 'Group ID must be in format: 123456789@g.us' }, 400)
      }
      await whatsAppClient.sendMessage(groupId, message, { sendSeen: false })
      return c.json({ success: true, message: 'Group message sent successfully', groupId }, 200)
    }

    const groupChat = await getGroupChat(undefined, groupName)
    await groupChat.sendMessage(message, { sendSeen: false })
    return c.json({ success: true, message: 'Group message sent successfully', groupId: groupChat.id._serialized, groupName: groupChat.name || null }, 200)
  } catch (error) {
    console.error('Error sending group message:', error)
    return c.json(
      { success: false, error: 'Failed to send group message', details: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined },
      500,
    )
  }
})

// POST /send-group-image
const sendGroupImageRoute = createRoute({
  method: 'post',
  path: '/send-group-image',
  tags: ['WhatsApp - Group'],
  summary: 'Kirim Gambar ke Grup',
  description: 'Mengirim gambar ke grup WhatsApp. Gambar bisa berupa URL atau path file lokal. Bisa menggunakan **groupId** atau **groupName**.',
  request: {
    body: { content: { 'application/json': { schema: SendGroupImageBodySchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SendGroupImageResponseSchema } },
      description: 'Gambar berhasil dikirim ke grup',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Request tidak valid',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Grup tidak ditemukan',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal mengirim gambar ke grup',
    },
  },
})

whatsapp.openapi(sendGroupImageRoute, async (c) => {
  try {
    const { groupId, groupName, image, message } = c.req.valid('json')
    if (!image) return c.json({ success: false, error: 'Image is required', details: 'Image can be a file path (local) or URL' }, 400)
    if (!groupId && !groupName) {
      return c.json({ success: false, error: 'Either groupId or groupName is required', details: 'groupId format: 123456789@g.us or groupName: name of the group' }, 400)
    }

    let media: any
    if (image.startsWith('http://') || image.startsWith('https://')) {
      console.log(`Loading image from URL: ${image}`)
      media = await MessageMedia.fromUrl(image)
    } else {
      console.log(`Loading image from file: ${image}`)
      media = MessageMedia.fromFilePath(image)
    }

    if (groupId) {
      if (!groupId.includes('@g.us')) {
        return c.json({ success: false, error: 'Invalid group ID format', details: 'Group ID must be in format: 123456789@g.us' }, 400)
      }
      const options: any = { sendSeen: false }
      if (message) options.caption = message
      await whatsAppClient.sendMessage(groupId, media, options)
      return c.json({ success: true, message: 'Group image sent successfully', groupId }, 200)
    }

    const groupChat = await getGroupChat(undefined, groupName)
    const options: any = { sendSeen: false }
    if (message) options.caption = message
    await groupChat.sendMessage(media, options)
    return c.json(
      { success: true, message: 'Group image sent successfully', groupId: groupChat.id._serialized, groupName: groupChat.name || null, caption: message || null },
      200,
    )
  } catch (error) {
    console.error('Error sending group image:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes('Group') && errorMessage.includes('not found')) {
      return c.json({ success: false, error: 'Group not found', details: errorMessage }, 404)
    }
    if (errorMessage.includes('not a group')) {
      return c.json({ success: false, error: 'Invalid group', details: errorMessage }, 400)
    }
    return c.json(
      { success: false, error: 'Failed to send group image', details: errorMessage, stack: error instanceof Error ? error.stack : undefined },
      500,
    )
  }
})

// POST /logout
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['WhatsApp - Management'],
  summary: 'Logout dari WhatsApp',
  description: '⚠️ **Hati-hati!** Endpoint ini akan logout dari WhatsApp dan menghancurkan session aktif. Setelah logout, Anda perlu scan QR code lagi.',
  responses: {
    200: {
      content: { 'application/json': { schema: LogoutResponseSchema } },
      description: 'Logout berhasil',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal logout',
    },
  },
})

whatsapp.openapi(logoutRoute, async (c) => {
  try {
    console.log('Logging out from WhatsApp...')
    await whatsAppClient.logout()
    await whatsAppClient.destroy()
    try {
      await execAsync('pkill -f "chromium.*wwebjs_auth" || true')
      console.info('Cleaned up browser processes')
    } catch { console.info('No browser processes to clean up') }
    return c.json({ success: true, message: 'Logged out successfully from WhatsApp' }, 200)
  } catch (error) {
    console.error('Error logging out:', error)
    return c.json({ success: false, error: 'Failed to logout', details: error instanceof Error ? error.message : String(error) }, 500)
  }
})

// DELETE /auth
const authRoute = createRoute({
  method: 'delete',
  path: '/auth',
  tags: ['WhatsApp - Management'],
  summary: 'Hapus Auth Data',
  description: '⚠️ **Hati-hati!** Menghapus folder `.wwebjs_auth`. Setelah ini restart service dan scan QR code lagi.',
  responses: {
    200: {
      content: { 'application/json': { schema: AuthClearResponseSchema } },
      description: 'Auth data berhasil dihapus',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal menghapus auth data',
    },
  },
})

whatsapp.openapi(authRoute, async (c) => {
  try {
    console.log('Clearing auth data...')
    const authPath = './.wwebjs_auth'
    try {
      await fs.rm(authPath, { recursive: true, force: true })
      console.info('Auth data cleared successfully')
      return c.json({ success: true, message: 'Auth data cleared successfully', note: 'Please restart the service to initialize new session' }, 200)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return c.json({ success: true, message: 'Auth data already cleared or does not exist' }, 200)
      }
      throw error
    }
  } catch (error) {
    console.error('Error clearing auth data:', error)
    return c.json({ success: false, error: 'Failed to clear auth data', details: error instanceof Error ? error.message : String(error) }, 500)
  }
})

// DELETE /cache
const cacheRoute = createRoute({
  method: 'delete',
  path: '/cache',
  tags: ['WhatsApp - Management'],
  summary: 'Hapus Cache Data',
  description: 'Menghapus folder `.wwebjs_cache`. Berguna untuk membebaskan ruang disk atau mengatasi masalah cache corrupt.',
  responses: {
    200: {
      content: { 'application/json': { schema: CacheClearResponseSchema } },
      description: 'Cache data berhasil dihapus',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal menghapus cache',
    },
  },
})

whatsapp.openapi(cacheRoute, async (c) => {
  try {
    console.log('Clearing cache data...')
    const cachePath = './.wwebjs_cache'
    try {
      await fs.rm(cachePath, { recursive: true, force: true })
      console.info('Cache data cleared successfully')
      return c.json({ success: true, message: 'Cache data cleared successfully' }, 200)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return c.json({ success: true, message: 'Cache data already cleared or does not exist' }, 200)
      }
      throw error
    }
  } catch (error) {
    console.error('Error clearing cache data:', error)
    return c.json({ success: false, error: 'Failed to clear cache data', details: error instanceof Error ? error.message : String(error) }, 500)
  }
})

// POST /reset
const resetRoute = createRoute({
  method: 'post',
  path: '/reset',
  tags: ['WhatsApp - Management'],
  summary: 'Reset Lengkap Service',
  description: '⚠️ **Hati-hati!** Melakukan reset lengkap: logout + hapus auth + hapus cache. Setelah reset, **restart service** diperlukan.',
  responses: {
    200: {
      content: { 'application/json': { schema: ResetResponseSchema } },
      description: 'Reset berhasil',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Gagal reset',
    },
  },
})

whatsapp.openapi(resetRoute, async (c) => {
  try {
    console.log('Resetting WhatsApp service (logout + clear auth + clear cache)...')
    const results = { logout: false, authCleared: false, cacheCleared: false }

    // 1. Logout
    try {
      await whatsAppClient.logout()
      await whatsAppClient.destroy()
      try { await execAsync('pkill -f "chromium.*wwebjs_auth" || true') } catch {}
      results.logout = true
      console.info('Logged out successfully')
    } catch (error) { console.warn('Logout error (might already be logged out):', error) }

    // 2. Clear auth
    try {
      await fs.rm('./.wwebjs_auth', { recursive: true, force: true })
      results.authCleared = true
      console.info('Auth data cleared')
    } catch (error: any) {
      if (error.code === 'ENOENT') results.authCleared = true
      else console.warn('Error clearing auth:', error)
    }

    // 3. Clear cache
    try {
      await fs.rm('./.wwebjs_cache', { recursive: true, force: true })
      results.cacheCleared = true
      console.info('Cache data cleared')
    } catch (error: any) {
      if (error.code === 'ENOENT') results.cacheCleared = true
      else console.warn('Error clearing cache:', error)
    }

    return c.json({ success: true, message: 'WhatsApp service reset successfully', results, note: 'Please restart the service to initialize new session' }, 200)
  } catch (error) {
    console.error('Error resetting service:', error)
    return c.json({ success: false, error: 'Failed to reset service', details: error instanceof Error ? error.message : String(error) }, 500)
  }
})

export default whatsapp
