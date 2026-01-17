import { Hono } from 'hono'
import { whatsAppClient } from '@/clients/whatsapp.js'
import whatsappWeb from 'whatsapp-web.js'
import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
const { MessageMedia } = whatsappWeb
const execAsync = promisify(exec)

const whatsapp = new Hono()

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
    groupChat = await whatsAppClient.getChatById(groupId)
    
    if (!groupChat) {
      throw new Error(`Group with ID ${groupId} not found. Make sure you're still in the group.`)
    }

    if (!groupChat.isGroup) {
      throw new Error(`Chat with ID ${groupId} is not a group`)
    }
  } else if (groupName) {
    console.log(`Searching for group by name: ${groupName}`)
    const chats = await whatsAppClient.getChats()
    
    groupChat = chats.find((chat: any) => 
      chat.isGroup && chat.name?.toLowerCase() === groupName.toLowerCase()
    )

    if (!groupChat) {
      throw new Error(`Group with name "${groupName}" not found. Make sure the group name is correct and you're still in the group.`)
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

    const groupChat = await getGroupChat(groupId, groupName)

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
    const chats = await whatsAppClient.getChats()
    const groups = chats
      .filter((chat: any) => chat.isGroup)
      .map((chat: any) => ({
        id: chat.id._serialized,
        name: chat.name || 'Unknown',
        participantsCount: chat.participants?.length || 0
      }))

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
      details: errorMessage
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

    const groupChat = await getGroupChat(groupId, groupName)

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
