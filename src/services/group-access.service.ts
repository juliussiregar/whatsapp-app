import type { Client, GroupChat, GroupParticipant } from 'whatsapp-web.js'

export class GroupAccessError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'GroupAccessError'
	}
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
 * Pastikan bot masih anggota grup (bukan entri cache setelah leave).
 */
export async function assertBotInGroup(client: Client, groupId: string): Promise<GroupChat> {
	const chat = await getGroupChat(client, groupId)
	const botId = botWid(client)
	if (!botId) {
		throw new GroupAccessError('Bot belum siap — tunggu status ready lalu coba lagi.')
	}

	const participants = chat.participants ?? []
	const isMember = participants.some((p: GroupParticipant) => isSameParticipant(p.id?._serialized, botId))

	if (!participants.length || !isMember) {
		const label = chat.name || groupId
		throw new GroupAccessError(
			`Bot tidak lagi di grup "${label}" (0 anggota / sudah keluar). Buat grup baru di halaman ini atau perbarui mapping di ERP.`,
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

	const me = chat.participants.find((p: GroupParticipant) => isSameParticipant(p.id?._serialized, botId))
	if (!me?.isAdmin && !me?.isSuperAdmin) {
		const label = chat.name || groupId
		throw new GroupAccessError(
			`Bot bukan admin grup "${label}". Jadikan nomor bot sebagai admin di WhatsApp, lalu coba lagi.`,
		)
	}

	return chat
}
