import type { Client, GroupChat } from 'whatsapp-web.js'

export class GroupAccessError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'GroupAccessError'
	}
}

interface ResolvedParticipant {
	id: string
	isAdmin: boolean
	isSuperAdmin: boolean
}

export async function getGroupChat(client: Client, groupId: string): Promise<GroupChat> {
	if (!groupId.includes('@g.us')) {
		throw new GroupAccessError('Group ID harus berformat 123456789012345678@g.us')
	}

	const chat = await client.getChatById(groupId)
	if (!chat?.isGroup) {
		throw new GroupAccessError(`Chat ${groupId} bukan grup WhatsApp`)
	}

	return chat as GroupChat
}

function botWid(client: Client): string | null {
	return client.info?.wid?._serialized ?? null
}

function isSameParticipant(participantId: string | undefined, botId: string): boolean {
	if (!participantId) return false
	if (participantId === botId) return true
	const botUser = botId.split('@')[0]
	const partUser = participantId.split('@')[0]
	return Boolean(botUser && partUser && botUser === partUser)
}

/**
 * Muat anggota grup dari WhatsApp Web Store (lebih akurat daripada chat.participants dari getChatById).
 */
async function loadGroupParticipants(client: Client, groupId: string): Promise<ResolvedParticipant[]> {
	const pupPage = (client as { pupPage?: { evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> } })
		.pupPage
	if (!pupPage) {
		throw new GroupAccessError('WhatsApp client belum siap — tunggu status ready lalu coba lagi.')
	}

	const participants = await pupPage.evaluate(async (gid: string) => {
		function serializeId(id: unknown): string | null {
			if (!id) return null
			if (typeof id === 'string') return id
			if (typeof id !== 'object') return null
			const rec = id as Record<string, unknown>
			if (typeof rec._serialized === 'string') return rec._serialized
			if (typeof rec.user === 'string' && typeof rec.server === 'string') {
				return `${rec.user}@${rec.server}`
			}
			return null
		}

		async function readParticipants(chat: { groupMetadata?: { participants?: unknown } } | null) {
			const parts = chat?.groupMetadata?.participants as
				| { _models?: Array<Record<string, unknown>> }
				| Array<Record<string, unknown>>
				| undefined
			if (!parts) return []

			const models = Array.isArray(parts) ? parts : parts._models || []
			const out: Array<{ id: string; isAdmin: boolean; isSuperAdmin: boolean }> = []

			for (const p of models) {
				const pid = serializeId(p.id)
				if (!pid) continue
				out.push({
					id: pid,
					isAdmin: Boolean(p.isAdmin),
					isSuperAdmin: Boolean(p.isSuperAdmin),
				})
			}
			return out
		}

		// @ts-expect-error injected in WhatsApp Web
		const getChat = () => window.WWebJS.getChat(gid, { getAsModel: false })
		// @ts-expect-error injected in WhatsApp Web
		const refresh = window.Store?.GroupQueryAndUpdate

		let chat = await getChat()
		let participants = await readParticipants(chat)

		if (!participants.length && typeof refresh === 'function') {
			try {
				await refresh(gid)
			} catch {
				/* ignore */
			}
			chat = await getChat()
			participants = await readParticipants(chat)
		}

		return participants
	}, groupId)

	return participants as ResolvedParticipant[]
}

/**
 * Pastikan bot masih anggota grup (bukan entri cache setelah leave).
 */
export async function assertBotInGroup(client: Client, groupId: string): Promise<GroupChat> {
	const chat = await getGroupChat(client, groupId)
	const botId = botWid(client)
	if (!botId) {
		throw new GroupAccessError('Bot belum siap — tunggu status ready lalu coba lagi.')
	}

	const participants = await loadGroupParticipants(client, groupId)
	const isMember = participants.some((p) => isSameParticipant(p.id, botId))
	const label = chat.name || groupId

	if (!participants.length) {
		throw new GroupAccessError(
			`Tidak bisa membaca anggota grup "${label}". Grup mungkin sudah dihapus atau bot sudah keluar. Buat grup baru atau perbarui mapping di ERP.`,
		)
	}

	if (!isMember) {
		throw new GroupAccessError(
			`Bot tidak ada di grup "${label}" (${participants.length} anggota lain). Perbarui Group ID di ERP ke grup yang benar.`,
		)
	}

	return chat
}

/**
 * Operasi seperti tambah anggota atau ubah izin pesan membutuhkan bot sebagai admin.
 */
export async function assertBotIsGroupAdmin(client: Client, groupId: string): Promise<GroupChat> {
	const chat = await assertBotInGroup(client, groupId)
	const botId = botWid(client)
	if (!botId) {
		throw new GroupAccessError('Bot belum siap — tunggu status ready lalu coba lagi.')
	}

	const participants = await loadGroupParticipants(client, groupId)
	const me = participants.find((p) => isSameParticipant(p.id, botId))
	if (!me?.isAdmin && !me?.isSuperAdmin) {
		const label = chat.name || groupId
		throw new GroupAccessError(
			`Bot bukan admin grup "${label}". Jadikan nomor bot sebagai admin di WhatsApp, lalu coba lagi.`,
		)
	}

	return chat
}
