import { Hono } from 'hono'
import { whatsAppClient, isReady } from '@/clients/whatsapp.js'
import whatsappWeb from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
const { MessageMedia } = whatsappWeb
const execAsync = promisify(exec)

const whatsapp = new Hono()

// Endpoint untuk check status client
whatsapp.get('/status', (c) => {
  const ready = isReady()
  return c.json({
    ready,
    message: ready 
      ? 'WhatsApp client is ready to send messages' 
      : 'WhatsApp client is not ready. Please wait for initialization and scan QR code if needed.'
  })
})

// Helper function untuk format nomor
function formatPhoneNumber(phoneNumber: string): string {
  let formatted = phoneNumber.trim().replaceAll(/\D/g, '')
  if (formatted.startsWith('0')) {
    formatted = '62' + formatted.substring(1)
  } else if (!formatted.startsWith('62') && formatted.length <= 10) {
    formatted = '62' + formatted
  }
  return formatted
}

// Helper function untuk validasi dan mendapatkan contact
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

// Helper function untuk mengirim pesan dengan error handling
async function sendMessageSafely(contactId: string, content: any, options: any = {}) {
  const contact = await whatsAppClient.getContactById(contactId)
  if (!contact) {
    throw new Error('Contact not found')
  }

  let chat = await contact.getChat()
  
  if (chat) {
    // Chat sudah ada, verifikasi dulu
    const verifiedChat = await whatsAppClient.getChatById(chat.id._serialized)
    if (verifiedChat) {
      await verifiedChat.sendMessage(content, { ...options, sendSeen: false })
    } else {
      await whatsAppClient.sendMessage(contactId, content, { ...options, sendSeen: false })
    }
  } else {
    // Chat baru, gunakan client.sendMessage dengan sendSeen: false
    await whatsAppClient.sendMessage(contactId, content, { ...options, sendSeen: false })
  }
}

// Helper function untuk mendapatkan grup (by ID atau name)
async function getGroupChat(groupId?: string, groupName?: string) {
  let groupChat: any = null

  if (groupId) {
    console.log(`Getting group by ID: ${groupId}`)
    
    // Coba getChatById dulu, tapi jika error, fallback ke getChats()
    try {
      groupChat = await whatsAppClient.getChatById(groupId)
      
      if (groupChat && groupChat.isGroup) {
        return groupChat
      }
      
      if (groupChat && !groupChat.isGroup) {
        throw new Error(`Chat with ID ${groupId} is not a group`)
      }
    } catch (error) {
      console.warn(`getChatById failed for ${groupId}, trying getChats() fallback:`, error)
    }
    
    // Jika getChatById gagal, kita tidak bisa fallback ke getChats() karena bug
    // Return error dan biarkan caller handle (biasanya akan langsung gunakan sendMessage dengan groupId)
    throw new Error(`Cannot get group with ID ${groupId}. Try using sendMessage directly with groupId instead.`)
  } else if (groupName) {
    console.log(`Searching for group by name: ${groupName}`)
    
    // Gunakan workaround yang sama seperti di endpoint /groups
    const pupPage = (whatsAppClient as any).pupPage
    if (!pupPage) {
      throw new Error('WhatsApp client page not available')
    }
    
    try {
      // Akses langsung ke Store.Chat.getModelsArray() tanpa getChatModel
      const result = await pupPage.evaluate((searchName: string) => {
        try {
          // @ts-ignore - window tersedia di browser context
          const chats = window.Store.Chat.getModelsArray()
          
          for (const chat of chats) {
            try {
              // @ts-ignore - window tersedia di browser context
              const store = window.Store
              
              // Cek apakah ini grup
              const hasGroupMetadata = chat.groupMetadata !== undefined && chat.groupMetadata !== null
              const isGroupId = typeof chat.id?.isGroup === 'function' ? chat.id.isGroup() : false
              const isGroupIdString = chat.id?._serialized?.endsWith('@g.us') || false
              const isNewsletter = store.ChatGetters?.getIsNewsletter?.(chat) || false
              
              const isGroup = (hasGroupMetadata || isGroupId || isGroupIdString) && !isNewsletter
              
              if (isGroup) {
                const name = chat.name || chat.formattedTitle || chat.contact?.formattedName || ''
                if (name.toLowerCase() === searchName.toLowerCase()) {
                  return {
                    id: chat.id?._serialized || chat.id?.user || chat.id,
                    name: name
                  }
                }
              }
            } catch {
              continue
            }
          }
          
          return null
        } catch (error) {
          throw error
        }
      }, groupName)
      
      if (!result || !result.id) {
        throw new Error(`Group with name "${groupName}" not found. Make sure the group name is correct and you're still in the group.`)
      }
      
      // Return group info dengan ID yang ditemukan
      // Jangan gunakan getChatById karena bisa error, langsung return object sederhana
      return {
        id: { _serialized: result.id },
        name: result.name,
        isGroup: true,
        // Method untuk sendMessage akan menggunakan client.sendMessage dengan ID
        sendMessage: async (content: any, options: any = {}) => {
          return await whatsAppClient.sendMessage(result.id, content, options)
        }
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error) || ''
      throw new Error(`Failed to find group "${groupName}": ${errorMessage}`)
    }
  }

  return groupChat
}

whatsapp.post('/send-message', async (c) => {
  try {
    const { phoneNumber, message } = await c.req.json()

    if (!phoneNumber || !message) {
      return c.json({
        success: false,
        error: 'Phone number and message are required'
      }, 400)
    }

    const formattedPhone = formatPhoneNumber(phoneNumber)
    const { contactId } = await getValidatedContact(formattedPhone)
    
    await sendMessageSafely(contactId, message)

    return c.json({
      success: true,
      message: 'Message sent successfully',
      to: formattedPhone
    })
  } catch (error) {
    console.error('Error sending WhatsApp message:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    return c.json({
      success: false,
      error: 'Failed to send message',
      details: errorMessage,
      stack: errorStack
    }, 500)
  }
})

// Endpoint untuk mengirim gambar
whatsapp.post('/send-image', async (c) => {
  try {
    const { phoneNumber, image, message } = await c.req.json()

    if (!phoneNumber || !image) {
      return c.json({
        success: false,
        error: 'Phone number and image are required',
        details: 'Image can be a file path (local) or URL'
      }, 400)
    }

    const formattedPhone = formatPhoneNumber(phoneNumber)
    const { contactId } = await getValidatedContact(formattedPhone)

    // Buat MessageMedia dari file path atau URL
    let media: any
    if (image.startsWith('http://') || image.startsWith('https://')) {
      // Dari URL
      console.log(`Loading image from URL: ${image}`)
      media = await MessageMedia.fromUrl(image)
    } else {
      // Dari file path lokal
      console.log(`Loading image from file: ${image}`)
      media = MessageMedia.fromFilePath(image)
    }

    // Kirim gambar dengan message/caption (jika ada)
    const options: any = { sendSeen: false }
    if (message) {
      options.caption = message
    }

    await sendMessageSafely(contactId, media, options)

    return c.json({
      success: true,
      message: 'Image sent successfully',
      to: formattedPhone,
      caption: message || null
    })
  } catch (error) {
    console.error('Error sending WhatsApp image:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    return c.json({
      success: false,
      error: 'Failed to send image',
      details: errorMessage,
      stack: errorStack
    }, 500)
  }
})

// Endpoint untuk mengirim pesan ke grup
whatsapp.post('/send-group-message', async (c) => {
  try {
    const { groupId, groupName, message } = await c.req.json()

    if (!message) {
      return c.json({
        success: false,
        error: 'Message is required'
      }, 400)
    }

    if (!groupId && !groupName) {
      return c.json({
        success: false,
        error: 'Either groupId or groupName is required',
        details: 'groupId format: 123456789@g.us or groupName: name of the group'
      }, 400)
    }

    // Jika groupId diberikan, langsung gunakan sendMessage tanpa perlu getChatById
    // Ini lebih aman dan menghindari error "Cannot read properties of undefined"
    if (groupId) {
      // Validasi format groupId
      if (!groupId.includes('@g.us')) {
        return c.json({
          success: false,
          error: 'Invalid group ID format',
          details: 'Group ID must be in format: 123456789@g.us'
        }, 400)
      }
      
      // Langsung kirim pesan ke groupId
      await whatsAppClient.sendMessage(groupId, message, { sendSeen: false })
      
      return c.json({
        success: true,
        message: 'Group message sent successfully',
        groupId: groupId
      })
    }

    // Jika groupName diberikan, perlu getChat untuk mendapatkan groupId
    const groupChat = await getGroupChat(undefined, groupName)

    // Kirim pesan ke grup
    await groupChat.sendMessage(message, { sendSeen: false })

    return c.json({
      success: true,
      message: 'Group message sent successfully',
      groupId: groupChat.id._serialized,
      groupName: groupChat.name || null
    })
  } catch (error) {
    console.error('Error sending group message:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    return c.json({
      success: false,
      error: 'Failed to send group message',
      details: errorMessage,
      stack: errorStack
    }, 500)
  }
})

// Endpoint untuk mendapatkan daftar grup
whatsapp.get('/groups', async (c) => {
  try {
    // Workaround: Gunakan evaluate langsung untuk akses Store.Chat tanpa getChatModel
    // Ini menghindari bug "Cannot read properties of undefined (reading 'update')"
    let groups: any[] = []
    let retries = 3
    let lastError: any = null
    
    // Cek apakah pupPage tersedia
    const pupPage = (whatsAppClient as any).pupPage
    if (!pupPage) {
      return c.json({
        success: false,
        error: 'WhatsApp client page not available',
        details: 'The browser page is not initialized yet. Please wait for the client to be ready.'
      }, 503)
    }
    
    while (retries > 0) {
      try {
        // Akses langsung ke Store.Chat.getModelsArray() dan filter sendiri
        // Note: window akan tersedia di browser context saat evaluate
        const rawChats = await pupPage.evaluate(() => {
          try {
            // @ts-ignore - window tersedia di browser context
            const chats = window.Store.Chat.getModelsArray()
            const groups: any[] = []
            let totalChats = chats.length
            let groupCount = 0
            
            for (const chat of chats) {
              try {
                // @ts-ignore - window tersedia di browser context
                const store = window.Store
                
                // Cek apakah ini grup: ada groupMetadata atau id.isGroup() atau id berakhir dengan @g.us
                const hasGroupMetadata = chat.groupMetadata !== undefined && chat.groupMetadata !== null
                const isGroupId = typeof chat.id?.isGroup === 'function' ? chat.id.isGroup() : false
                const isGroupIdString = chat.id?._serialized?.endsWith('@g.us') || false
                const isNewsletter = store.ChatGetters?.getIsNewsletter?.(chat) || false
                
                // Ini grup jika ada groupMetadata atau isGroup() true, dan bukan newsletter
                const isGroup = (hasGroupMetadata || isGroupId || isGroupIdString) && !isNewsletter
                
                if (isGroup) {
                  groupCount++
                  const chatId = chat.id?._serialized || chat.id?.user || chat.id
                  const name = chat.name || chat.formattedTitle || chat.contact?.formattedName || 'Unknown'
                  
                  // Get participants count dari groupMetadata jika ada
                  let participantsCount = 0
                  if (chat.groupMetadata && chat.groupMetadata.participants) {
                    const participants = chat.groupMetadata.participants
                    if (participants._models) {
                      participantsCount = participants._models.length
                    } else if (Array.isArray(participants)) {
                      participantsCount = participants.length
                    }
                  }
                  
                  groups.push({
                    id: chatId,
                    name: name,
                    participantsCount: participantsCount
                  })
                }
              } catch (err) {
                // Skip chat yang error
                continue
              }
            }
            
            // Return dengan debug info
            return { groups, debug: { totalChats, groupCount } }
          } catch (error) {
            throw error
          }
        })
        
        // Extract groups dari result
        if (rawChats && typeof rawChats === 'object' && 'groups' in rawChats) {
          groups = rawChats.groups || []
          if (rawChats.debug) {
            console.log(`Debug: Total chats: ${rawChats.debug.totalChats}, Groups found: ${rawChats.debug.groupCount}`)
          }
        } else {
          // Fallback jika format berbeda
          groups = Array.isArray(rawChats) ? rawChats : []
        }
        
        groups = rawChats || []
        console.log(`Found ${groups.length} groups using direct Store.Chat access`)
        break // Success
      } catch (error: any) {
        lastError = error
        retries--
        
        const errorMessage = error?.message || String(error) || ''
        console.warn(`getChats() alternative method failed (attempt ${3 - retries}/3):`, errorMessage)
        
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
      }
    }
    
    // Jika masih error, coba fallback ke getChats() biasa dengan error handling lebih baik
    if (groups.length === 0 && lastError) {
      console.log('Trying fallback to standard getChats() method...')
      try {
        const chats = await whatsAppClient.getChats()
        groups = chats
          .filter((chat: any) => {
            try {
              return chat && chat.isGroup === true
            } catch {
              return false
            }
          })
          .map((chat: any) => {
            try {
              return {
                id: chat.id?._serialized || chat.id || 'unknown',
                name: chat.name || 'Unknown',
                participantsCount: chat.participants?.length || 0
              }
            } catch {
              return null
            }
          })
          .filter((group: any) => group !== null)
      } catch (fallbackError: any) {
        const errorMessage = lastError?.message || String(lastError) || ''
        
        return c.json({
          success: false,
          error: 'Failed to get groups due to internal WhatsApp Web state issue',
          details: errorMessage,
          note: 'This is a known issue with whatsapp-web.js. The client is ready, but getChats() encountered an internal error. You can still send messages to groups using groupId directly via /whatsapp/send-group-message endpoint.',
          suggestion: 'If you know the groupId (format: 123456789@g.us), you can use it directly without needing to list groups first.'
        }, 500)
      }
    }

    return c.json({
      success: true,
      groups,
      total: groups.length
    })
  } catch (error) {
    console.error('Error getting groups:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    return c.json({
      success: false,
      error: 'Failed to get groups',
      details: errorMessage,
      note: 'This might be a temporary issue. Please try again or check if WhatsApp client is ready.'
    }, 500)
  }
})

// Endpoint untuk mengirim gambar ke grup
whatsapp.post('/send-group-image', async (c) => {
  try {
    const { groupId, groupName, image, message } = await c.req.json()

    if (!image) {
      return c.json({
        success: false,
        error: 'Image is required',
        details: 'Image can be a file path (local) or URL'
      }, 400)
    }

    if (!groupId && !groupName) {
      return c.json({
        success: false,
        error: 'Either groupId or groupName is required',
        details: 'groupId format: 123456789@g.us or groupName: name of the group'
      }, 400)
    }

    // Buat MessageMedia dari file path atau URL
    let media: any
    if (image.startsWith('http://') || image.startsWith('https://')) {
      // Dari URL
      console.log(`Loading image from URL: ${image}`)
      media = await MessageMedia.fromUrl(image)
    } else {
      // Dari file path lokal
      console.log(`Loading image from file: ${image}`)
      media = MessageMedia.fromFilePath(image)
    }

    // Jika groupId diberikan, langsung gunakan sendMessage tanpa perlu getGroupChat
    // Ini lebih aman dan menghindari error "Cannot read properties of undefined"
    if (groupId) {
      // Validasi format groupId
      if (!groupId.includes('@g.us')) {
        return c.json({
          success: false,
          error: 'Invalid group ID format',
          details: 'Group ID must be in format: 123456789@g.us'
        }, 400)
      }
      
      // Langsung kirim gambar ke groupId
      const options: any = { sendSeen: false }
      if (message) {
        options.caption = message
      }
      
      await whatsAppClient.sendMessage(groupId, media, options)
      
      return c.json({
        success: true,
        message: 'Group image sent successfully',
        groupId: groupId
      })
    }

    // Jika groupName diberikan, perlu getGroupChat untuk mendapatkan groupId
    const groupChat = await getGroupChat(undefined, groupName)

    // Kirim gambar dengan message/caption (jika ada)
    const options: any = { sendSeen: false }
    if (message) {
      options.caption = message
    }

    await groupChat.sendMessage(media, options)

    return c.json({
      success: true,
      message: 'Group image sent successfully',
      groupId: groupChat.id._serialized,
      groupName: groupChat.name || null,
      caption: message || null
    })
  } catch (error) {
    console.error('Error sending group image:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    // Handle specific errors
    if (errorMessage.includes('Group') && errorMessage.includes('not found')) {
      return c.json({
        success: false,
        error: 'Group not found',
        details: errorMessage
      }, 404)
    }

    if (errorMessage.includes('not a group')) {
      return c.json({
        success: false,
        error: 'Invalid group',
        details: errorMessage
      }, 400)
    }

    return c.json({
      success: false,
      error: 'Failed to send group image',
      details: errorMessage,
      stack: errorStack
    }, 500)
  }
})

// Endpoint untuk logout dari WhatsApp
whatsapp.post('/logout', async (c) => {
  try {
    console.log('Logging out from WhatsApp...')
    
    // Logout dan destroy client
    await whatsAppClient.logout()
    await whatsAppClient.destroy()
    
    // Clean up browser processes
    try {
      await execAsync('pkill -f "chromium.*wwebjs_auth" || true')
      console.info('Cleaned up browser processes')
    } catch (error) {
      console.info('No browser processes to clean up')
    }

    return c.json({
      success: true,
      message: 'Logged out successfully from WhatsApp'
    })
  } catch (error) {
    console.error('Error logging out:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    return c.json({
      success: false,
      error: 'Failed to logout',
      details: errorMessage
    }, 500)
  }
})

// Endpoint untuk menghapus auth data
whatsapp.delete('/auth', async (c) => {
  try {
    console.log('Clearing auth data...')
    
    const authPath = './.wwebjs_auth'
    
    try {
      // Hapus folder auth
      await fs.rm(authPath, { recursive: true, force: true })
      console.info('Auth data cleared successfully')
      
      return c.json({
        success: true,
        message: 'Auth data cleared successfully',
        note: 'Please restart the service to initialize new session'
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Folder tidak ada, sudah bersih
        return c.json({
          success: true,
          message: 'Auth data already cleared or does not exist'
        })
      }
      throw error
    }
  } catch (error) {
    console.error('Error clearing auth data:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    return c.json({
      success: false,
      error: 'Failed to clear auth data',
      details: errorMessage
    }, 500)
  }
})

// Endpoint untuk menghapus cache data
whatsapp.delete('/cache', async (c) => {
  try {
    console.log('Clearing cache data...')
    
    const cachePath = './.wwebjs_cache'
    
    try {
      // Hapus folder cache
      await fs.rm(cachePath, { recursive: true, force: true })
      console.info('Cache data cleared successfully')
      
      return c.json({
        success: true,
        message: 'Cache data cleared successfully'
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Folder tidak ada, sudah bersih
        return c.json({
          success: true,
          message: 'Cache data already cleared or does not exist'
        })
      }
      throw error
    }
  } catch (error) {
    console.error('Error clearing cache data:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    return c.json({
      success: false,
      error: 'Failed to clear cache data',
      details: errorMessage
    }, 500)
  }
})

// Endpoint untuk reset lengkap (logout + hapus auth + hapus cache)
whatsapp.post('/reset', async (c) => {
  try {
    console.log('Resetting WhatsApp service (logout + clear auth + clear cache)...')
    
    const results = {
      logout: false,
      authCleared: false,
      cacheCleared: false
    }

    // 1. Logout
    try {
      await whatsAppClient.logout()
      await whatsAppClient.destroy()
      
      // Clean up browser processes
      try {
        await execAsync('pkill -f "chromium.*wwebjs_auth" || true')
      } catch (error) {
        // Ignore error
      }
      
      results.logout = true
      console.info('Logged out successfully')
    } catch (error) {
      console.warn('Logout error (might already be logged out):', error)
    }

    // 2. Clear auth
    const authPath = './.wwebjs_auth'
    try {
      await fs.rm(authPath, { recursive: true, force: true })
      results.authCleared = true
      console.info('Auth data cleared')
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn('Error clearing auth:', error)
      } else {
        results.authCleared = true // Folder tidak ada = sudah bersih
      }
    }

    // 3. Clear cache
    const cachePath = './.wwebjs_cache'
    try {
      await fs.rm(cachePath, { recursive: true, force: true })
      results.cacheCleared = true
      console.info('Cache data cleared')
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn('Error clearing cache:', error)
      } else {
        results.cacheCleared = true // Folder tidak ada = sudah bersih
      }
    }

    return c.json({
      success: true,
      message: 'WhatsApp service reset successfully',
      results,
      note: 'Please restart the service to initialize new session'
    })
  } catch (error) {
    console.error('Error resetting service:', error)
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    return c.json({
      success: false,
      error: 'Failed to reset service',
      details: errorMessage
    }, 500)
  }
})

export default whatsapp
