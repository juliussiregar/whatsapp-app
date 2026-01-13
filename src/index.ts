import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import health from '@/routes/health'
import whatsapp from '@/routes/whatsapp'
import { init as initWhatsApp } from '@/clients/whatsapp'

const app = new Hono()

app.route('/health', health)
app.route('/whatsapp', whatsapp)

app.get('/', (c) => {
  return c.json({
    message: 'Welcome to HonoJS API',
    version: '1.0.0'
  })
})

const port = Number(process.env.PORT) || 3000

// Initialize WhatsApp client
initWhatsApp().catch((error) => {
  console.error('Failed to initialize WhatsApp client:', error)
})

// Start Hono server
serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
