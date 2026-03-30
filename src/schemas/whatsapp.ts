import { z } from '@hono/zod-openapi'

// ── Reusable schemas ────────────────────────────────────────────────

export const ErrorSchema = z
  .object({
    success: z.boolean().openapi({ example: false }),
    error: z.string().openapi({ example: 'Something went wrong' }),
    details: z.string().optional().openapi({ example: 'Detailed error message' }),
    stack: z.string().optional(),
  })
  .openapi('Error')

export const SuccessMessageSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Operation completed successfully' }),
  })
  .openapi('SuccessMessage')

// ── Status ──────────────────────────────────────────────────────────

export const StatusSchema = z
  .object({
    ready: z.boolean().openapi({ example: true }),
    state: z
      .enum([
        'initializing',
        'waiting_qr',
        'authenticated',
        'loading',
        'ready',
        'disconnected',
        'error',
      ])
      .openapi({ example: 'ready', description: 'State detail dari client' }),
    stateChangedAt: z.string().openapi({
      example: '2025-06-15T10:30:00.000Z',
      description: 'Waktu terakhir state berubah',
    }),
    uptime: z.number().openapi({ example: 120, description: 'Uptime client dalam detik sejak init terakhir' }),
    lastError: z.string().nullable().openapi({ example: null, description: 'Error terakhir (null jika tidak ada)' }),
    message: z.string().openapi({ example: 'WhatsApp client is ready to send messages.' }),
  })
  .openapi('Status')

// ── Reconnect ───────────────────────────────────────────────────────

export const ReconnectResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'WhatsApp client is reconnecting. Check /whatsapp/status for progress.' }),
    note: z.string().optional().openapi({ example: 'If a QR code is needed, check Docker logs.' }),
  })
  .openapi('ReconnectResponse')

// ── Send Message ────────────────────────────────────────────────────

export const SendMessageBodySchema = z.object({
  phoneNumber: z.string().openapi({
    example: '6281234567890',
    description: 'Nomor telepon tujuan. Format: 08xx, 628xx, atau +628xx',
  }),
  message: z.string().openapi({
    example: 'Halo! Ini pesan dari WhatsApp API 👋',
    description: 'Isi pesan yang akan dikirim',
  }),
})

export const SendMessageResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Message sent successfully' }),
    to: z.string().openapi({ example: '6281234567890' }),
  })
  .openapi('SendMessageResponse')

// ── Send Image ──────────────────────────────────────────────────────

export const SendImageBodySchema = z.object({
  phoneNumber: z.string().openapi({
    example: '6281234567890',
    description: 'Nomor telepon tujuan. Format: 08xx, 628xx, atau +628xx',
  }),
  image: z.string().openapi({
    example: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
    description: 'URL gambar (https://...) atau path file lokal di dalam container (/app/images/foto.jpg)',
  }),
  message: z.string().optional().openapi({
    example: 'Ini adalah caption gambar',
    description: 'Caption gambar (opsional)',
  }),
})

export const SendImageResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Image sent successfully' }),
    to: z.string().openapi({ example: '6281234567890' }),
    caption: z.string().nullable().openapi({ example: 'Ini adalah caption gambar' }),
  })
  .openapi('SendImageResponse')

// ── Groups ──────────────────────────────────────────────────────────

export const GroupSchema = z.object({
  id: z.string().openapi({ example: '120363012345678901@g.us' }),
  name: z.string().openapi({ example: 'Tim Project Alpha' }),
  participantsCount: z.number().openapi({ example: 15 }),
})

export const GroupsResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    groups: z.array(GroupSchema),
    total: z.number().openapi({ example: 3 }),
  })
  .openapi('GroupsResponse')

// ── Send Group Message ──────────────────────────────────────────────

export const SendGroupMessageBodySchema = z.object({
  groupId: z.string().optional().openapi({
    example: '120363012345678901@g.us',
    description: 'ID grup WhatsApp dalam format 123456789012345678@g.us (direkomendasikan)',
  }),
  groupName: z.string().optional().openapi({
    example: 'Tim Project Alpha',
    description: 'Nama grup WhatsApp (case-insensitive). Gunakan ini jika groupId tidak diketahui.',
  }),
  message: z.string().openapi({
    example: 'Halo semua! Ini pesan dari API 🚀',
    description: 'Isi pesan yang akan dikirim ke grup',
  }),
})

export const SendGroupMessageResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Group message sent successfully' }),
    groupId: z.string().openapi({ example: '120363012345678901@g.us' }),
    groupName: z.string().nullable().optional().openapi({ example: 'Tim Project Alpha' }),
  })
  .openapi('SendGroupMessageResponse')

// ── Send Group Image ────────────────────────────────────────────────

export const SendGroupImageBodySchema = z.object({
  groupId: z.string().optional().openapi({
    example: '120363012345678901@g.us',
    description: 'ID grup WhatsApp dalam format 123456789012345678@g.us (direkomendasikan)',
  }),
  groupName: z.string().optional().openapi({
    example: 'Tim Project Alpha',
    description: 'Nama grup WhatsApp (case-insensitive)',
  }),
  image: z.string().openapi({
    example: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
    description: 'URL gambar atau path file lokal di container',
  }),
  message: z.string().optional().openapi({
    example: 'Laporan grafik bulan ini 📊',
    description: 'Caption gambar (opsional)',
  }),
})

export const SendGroupImageResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Group image sent successfully' }),
    groupId: z.string().openapi({ example: '120363012345678901@g.us' }),
    groupName: z.string().nullable().optional().openapi({ example: 'Tim Project Alpha' }),
    caption: z.string().nullable().optional().openapi({ example: 'Laporan grafik bulan ini 📊' }),
  })
  .openapi('SendGroupImageResponse')

// ── Logout ──────────────────────────────────────────────────────────

export const LogoutResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Logged out successfully from WhatsApp' }),
  })
  .openapi('LogoutResponse')

// ── Auth ────────────────────────────────────────────────────────────

export const AuthClearResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Auth data cleared successfully' }),
    note: z.string().optional().openapi({ example: 'Please restart the service to initialize new session' }),
  })
  .openapi('AuthClearResponse')

// ── Cache ───────────────────────────────────────────────────────────

export const CacheClearResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'Cache data cleared successfully' }),
  })
  .openapi('CacheClearResponse')

// ── Reset ───────────────────────────────────────────────────────────

export const ResetResultsSchema = z.object({
  logout: z.boolean().openapi({ example: true }),
  authCleared: z.boolean().openapi({ example: true }),
  cacheCleared: z.boolean().openapi({ example: true }),
})

export const ResetResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    message: z.string().openapi({ example: 'WhatsApp service reset successfully' }),
    results: ResetResultsSchema,
    note: z.string().optional().openapi({ example: 'Please restart the service to initialize new session' }),
  })
  .openapi('ResetResponse')
