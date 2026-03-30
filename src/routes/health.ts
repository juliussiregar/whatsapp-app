import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

const HealthSchema = z
  .object({
    status: z.string().openapi({ example: 'ok' }),
    timestamp: z.string().openapi({ example: '2025-01-15T10:30:00.000Z' }),
    uptime: z.number().openapi({ example: 3600.5, description: 'Uptime dalam detik' }),
  })
  .openapi('Health')

const healthRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: 'Health Check',
  description: 'Mengecek apakah service berjalan dengan baik',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthSchema } },
      description: 'Service berjalan normal',
    },
  },
})

const health = new OpenAPIHono()

health.openapi(healthRoute, (c) => {
  return c.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    200,
  )
})

export default health
