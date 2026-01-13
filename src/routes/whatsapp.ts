import { Hono } from 'hono'
import { whatsAppClient } from '@/clients/whatsapp.js'

const whatsapp = new Hono()

whatsapp.post('/send-message', async (c) => {
  try {
    const { phoneNumber, message } = await c.req.json()

    if (!phoneNumber || !message) {
      return c.json({
        success: false,
        error: 'Phone number and message are required'
      }, 400)
    }

    // Convert phone number prefix from 0 to 62
    let formattedPhone = phoneNumber.trim()
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '62' + formattedPhone.substring(1)
    }

    // Format for WhatsApp (number@c.us)
    const chatId = `${formattedPhone}@c.us`

    // Send message
    await whatsAppClient.sendMessage(chatId, message)

    return c.json({
      success: true,
      message: 'Message sent successfully',
      to: formattedPhone
    })
  } catch (error) {
    console.error('Error sending WhatsApp message:', error)
    return c.json({
      success: false,
      error: 'Failed to send message',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default whatsapp
