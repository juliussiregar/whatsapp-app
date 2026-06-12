import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'

import { whatsAppClient, isReady } from '@/clients/whatsapp.js'
import {
	assertBotIsGroupAdmin,
	getBotGroupAccess,
	GroupAccessError,
} from '@/services/group-access.service.js'
import { summarizeParticipants } from '@/services/group-participant.mapper.js'
import {
	addParticipantsToGroup,
	createGroupWithParticipants,
	GroupValidationError,
	leaveGroup,
} from '@/services/group.service.js'
import { setGroupMessageMode } from '@/services/group-settings.service.js'
import {
	AddGroupParticipantsBodySchema,
	AddGroupParticipantsResponseSchema,
	CreateGroupBodySchema,
	CreateGroupResponseSchema,
	DeleteGroupBodySchema,
	DeleteGroupResponseSchema,
	ErrorSchema,
	GroupBotAccessQuerySchema,
	GroupBotAccessResponseSchema,
	SetGroupMessagePermissionBodySchema,
	SetGroupMessagePermissionResponseSchema,
} from '@/schemas/whatsapp.js'

function notReadyResponse(c: any) {
	return c.json(
		{
			success: false,
			error: 'WhatsApp client is not ready',
			details: 'Wait until status is ready before using this endpoint.',
		},
		503,
	)
}

function validationErrorResponse(c: any, error: GroupValidationError) {
	return c.json(
		{
			success: false,
			error: error.message,
			participants: error.participants,
			summary: summarizeParticipants(error.participants),
		},
		400,
	)
}

function groupAccessErrorResponse(c: any, error: GroupAccessError) {
	return c.json(
		{
			success: false,
			error: error.message,
		},
		400,
	)
}

const groupBotAccessRoute = createRoute({
	method: 'get',
	path: '/groups/bot-access',
	tags: ['WhatsApp - Group'],
	summary: 'Cek apakah bot masih anggota grup',
	request: {
		query: GroupBotAccessQuerySchema,
	},
	responses: {
		200: {
			content: { 'application/json': { schema: GroupBotAccessResponseSchema } },
			description: 'Status keanggotaan bot di grup',
		},
		503: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'WhatsApp client belum siap',
		},
	},
})

const createGroupRoute = createRoute({
	method: 'post',
	path: '/groups/create',
	tags: ['WhatsApp - Group'],
	summary: 'Buat grup baru + undang anggota',
	description:
		'Membuat grup WhatsApp baru dan menambahkan banyak nomor sekaligus. Nomor yang tidak bisa langsung ditambahkan akan menerima undangan privat (invite V4). Bot harus terhubung dan siap.',
	request: {
		body: { content: { 'application/json': { schema: CreateGroupBodySchema } }, required: true },
	},
	responses: {
		200: {
			content: { 'application/json': { schema: CreateGroupResponseSchema } },
			description: 'Grup berhasil dibuat',
		},
		400: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Tidak ada nomor valid',
		},
		500: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Gagal membuat grup',
		},
		503: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'WhatsApp client belum siap',
		},
	},
})

const addParticipantsRoute = createRoute({
	method: 'post',
	path: '/groups/add-participants',
	tags: ['WhatsApp - Group'],
	summary: 'Tambah anggota ke grup existing',
	description:
		'Menambahkan banyak nomor ke grup yang sudah ada. Bot harus menjadi admin grup agar bisa menambahkan anggota langsung.',
	request: {
		body: {
			content: { 'application/json': { schema: AddGroupParticipantsBodySchema } },
			required: true,
		},
	},
	responses: {
		200: {
			content: { 'application/json': { schema: AddGroupParticipantsResponseSchema } },
			description: 'Proses penambahan anggota selesai',
		},
		400: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Tidak ada nomor valid',
		},
		500: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Gagal menambahkan anggota',
		},
		503: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'WhatsApp client belum siap',
		},
	},
})

const deleteGroupRoute = createRoute({
	method: 'post',
	path: '/groups/delete',
	tags: ['WhatsApp - Group'],
	summary: 'Hapus grup (bot keluar dari grup)',
	description:
		'Membuat akun bot WhatsApp keluar dari grup. Grup hilang dari daftar bot; anggota lain tetap ada di grup. Ini bukan menghapus grup untuk semua orang.',
	request: {
		body: {
			content: { 'application/json': { schema: DeleteGroupBodySchema } },
			required: true,
		},
	},
	responses: {
		200: {
			content: { 'application/json': { schema: DeleteGroupResponseSchema } },
			description: 'Bot berhasil keluar dari grup',
		},
		400: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Group ID tidak valid',
		},
		500: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Gagal keluar dari grup',
		},
		503: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'WhatsApp client belum siap',
		},
	},
})

const setMessagePermissionRoute = createRoute({
	method: 'post',
	path: '/groups/set-message-permission',
	tags: ['WhatsApp - Group'],
	summary: 'Atur siapa yang boleh kirim pesan di grup',
	description:
		'Mengubah mode pengumuman grup. Gunakan messageMode=all agar semua anggota bisa chat (bukan hanya admin).',
	request: {
		body: {
			content: { 'application/json': { schema: SetGroupMessagePermissionBodySchema } },
			required: true,
		},
	},
	responses: {
		200: {
			content: { 'application/json': { schema: SetGroupMessagePermissionResponseSchema } },
			description: 'Pengaturan berhasil diterapkan',
		},
		500: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'Gagal mengubah pengaturan grup',
		},
		503: {
			content: { 'application/json': { schema: ErrorSchema } },
			description: 'WhatsApp client belum siap',
		},
	},
})

export function registerGroupManagementRoutes(app: OpenAPIHono) {
	app.openapi(groupBotAccessRoute, async (c) => {
		try {
			if (!isReady()) return notReadyResponse(c)

			const { groupId } = c.req.valid('query')
			const access = await getBotGroupAccess(whatsAppClient, groupId)

			return c.json(
				{
					success: true,
					groupId,
					botIsMember: access.botIsMember,
					participantsCount: access.participantsCount,
					isAdmin: access.isAdmin,
				},
				200,
			)
		} catch (error) {
			console.error('Error checking group bot access:', error)
			return c.json(
				{
					success: false,
					error: 'Failed to check group access',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			)
		}
	})

	app.openapi(createGroupRoute, async (c) => {
		try {
			if (!isReady()) return notReadyResponse(c)

			const {
				name,
				participants,
				inviteComment,
				messageMode,
				promoteMembersToAdmin,
				batchSize,
				batchDelayMs,
			} = c.req.valid('json')
			const result = await createGroupWithParticipants(whatsAppClient, name, participants, {
				inviteComment,
				messageMode,
				promoteMembersToAdmin,
				batchSize,
				batchDelayMs,
			})

			return c.json({ success: true, ...result }, 200)
		} catch (error) {
			if (error instanceof GroupValidationError) {
				return validationErrorResponse(c, error)
			}
			console.error('Error creating WhatsApp group:', error)
			return c.json(
				{
					success: false,
					error: 'Failed to create group',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			)
		}
	})

	app.openapi(addParticipantsRoute, async (c) => {
		try {
			if (!isReady()) return notReadyResponse(c)

			const { groupId, participants, batchSize, batchDelayMs } = c.req.valid('json')
			const result = await addParticipantsToGroup(whatsAppClient, groupId, participants, {
				batchSize,
				batchDelayMs,
			})

			return c.json({ success: true, ...result }, 200)
		} catch (error) {
			if (error instanceof GroupAccessError) {
				return groupAccessErrorResponse(c, error)
			}
			if (error instanceof GroupValidationError) {
				return validationErrorResponse(c, error)
			}
			console.error('Error adding group participants:', error)
			return c.json(
				{
					success: false,
					error: 'Failed to add participants',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			)
		}
	})

	app.openapi(deleteGroupRoute, async (c) => {
		try {
			if (!isReady()) return notReadyResponse(c)

			const { groupId } = c.req.valid('json')
			const result = await leaveGroup(whatsAppClient, groupId)

			return c.json(
				{
					success: true,
					groupId: result.groupId,
					groupName: result.groupName,
					message: `Bot telah keluar dari grup "${result.groupName}".`,
				},
				200,
			)
		} catch (error) {
			console.error('Error leaving WhatsApp group:', error)
			return c.json(
				{
					success: false,
					error: 'Failed to delete group',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			)
		}
	})

	app.openapi(setMessagePermissionRoute, async (c) => {
		try {
			if (!isReady()) return notReadyResponse(c)

			const { groupId, messageMode } = c.req.valid('json')
			const mode = messageMode === 'admins_only' ? 'admins_only' : 'all'
			await assertBotIsGroupAdmin(whatsAppClient, groupId)
			const ok = await setGroupMessageMode(whatsAppClient, groupId, mode)

			if (!ok) {
				return c.json(
					{
						success: false,
						error: 'Failed to update group message permission',
						details: 'Bot harus admin grup. Coba lagi atau ubah manual di WhatsApp.',
					},
					500,
				)
			}

			return c.json(
				{
					success: true,
					groupId,
					messageMode: mode,
					membersCanSendMessages: mode === 'all',
				},
				200,
			)
		} catch (error) {
			if (error instanceof GroupAccessError) {
				return groupAccessErrorResponse(c, error)
			}
			console.error('Error setting group message permission:', error)
			return c.json(
				{
					success: false,
					error: 'Failed to update group message permission',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			)
		}
	})
}
