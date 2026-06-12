import type { Client } from 'whatsapp-web.js'

import { getGroupChat } from '@/services/group-access.service.js'
import type { AppliedGroupSettings, CreateGroupSettingsOptions, GroupMessageMode } from '@/types/group-settings.js'

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveMessageMode(options: CreateGroupSettingsOptions): GroupMessageMode {
	return options.messageMode === 'admins_only' ? 'admins_only' : 'all'
}

/**
 * Set who can send messages. Retries because group metadata may not be ready immediately after create.
 */
export async function setGroupMessageMode(
	client: Client,
	groupId: string,
	messageMode: GroupMessageMode,
): Promise<boolean> {
	const adminsOnly = messageMode === 'admins_only'

	for (let attempt = 0; attempt < 4; attempt++) {
		if (attempt > 0) {
			await sleep(1000 * attempt)
		}

		try {
			const chat = await getGroupChat(client, groupId)
			const ok = await chat.setMessagesAdminsOnly(adminsOnly)
			if (ok !== false) {
				return true
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			console.warn(
				`[WA Group] setMessagesAdminsOnly attempt ${attempt + 1}/4 failed (${groupId}, adminsOnly=${adminsOnly}): ${detail}`,
			)
		}
	}

	return false
}

/**
 * Apply post-create group policies (message permission + optional admin promotion).
 * Bot must remain group admin for these calls to succeed.
 */
export async function applyGroupSettingsAfterCreate(
	client: Client,
	groupId: string,
	memberApiIds: string[],
	options: CreateGroupSettingsOptions = {},
): Promise<AppliedGroupSettings> {
	const messageMode = resolveMessageMode(options)
	const adminsOnly = messageMode === 'admins_only'
	const promoteMembersToAdmin = Boolean(options.promoteMembersToAdmin)

	await sleep(800)
	const messagesOk = await setGroupMessageMode(client, groupId, messageMode)

	let membersPromotedToAdmin = false
	let promoteFailed = false

	if (promoteMembersToAdmin && memberApiIds.length) {
		try {
			const chat = await getGroupChat(client, groupId)
			const result = await chat.promoteParticipants(memberApiIds)
			membersPromotedToAdmin = result?.status === 200
			if (!membersPromotedToAdmin) promoteFailed = true
		} catch {
			promoteFailed = true
		}
	}

	return {
		messageMode,
		membersCanSendMessages: !adminsOnly && messagesOk !== false,
		membersPromotedToAdmin,
		promoteFailed,
	}
}

export function createGroupAnnounceFlag(messageMode: GroupMessageMode): boolean {
	return messageMode === 'admins_only'
}
