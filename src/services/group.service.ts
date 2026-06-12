import type { Client, GroupChat } from 'whatsapp-web.js'

import { assertBotInGroup, getGroupChat } from '@/services/group-access.service.js'
import {
	mapWaParticipantResults,
	summarizeParticipants,
} from '@/services/group-participant.mapper.js'
import { applyGroupSettingsAfterCreate, createGroupAnnounceFlag } from '@/services/group-settings.service.js'
import { pickParticipantApiId } from '@/services/phone.service.js'
import { resolveParticipantInputs } from '@/services/participant-resolver.service.js'
import type {
	AddParticipantsResult,
	BatchOptions,
	CreateGroupResult,
	ParticipantOutcome,
} from '@/types/group-participant.js'
import type { CreateGroupSettingsOptions } from '@/types/group-settings.js'

const DEFAULT_BATCH_SIZE = 15
const DEFAULT_BATCH_DELAY_MS = 2000

export interface CreateGroupOptions extends Partial<BatchOptions>, CreateGroupSettingsOptions {
	inviteComment?: string
}

export interface AddParticipantsOptions extends Partial<BatchOptions> {}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeBatchOptions(options: Partial<BatchOptions>): BatchOptions {
	return {
		batchSize: Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 30)),
		batchDelayMs: Math.max(0, options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS),
	}
}

function chunk<T>(items: T[], size: number): T[][] {
	const batches: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		batches.push(items.slice(i, i + size))
	}
	return batches
}

function isCreateGroupError(result: unknown): result is string {
	return typeof result === 'string'
}

async function addParticipantBatches(
	client: Client,
	groupId: string,
	contactIds: string[],
	options: BatchOptions,
): Promise<Record<string, unknown>> {
	const chat = await getGroupChat(client, groupId)
	const merged: Record<string, unknown> = {}
	const batches = chunk(contactIds, options.batchSize)

	for (let i = 0; i < batches.length; i++) {
		const batch = batches[i]
		const batchResult = await chat.addParticipants(batch)
		Object.assign(merged, batchResult)

		if (i < batches.length - 1 && options.batchDelayMs > 0) {
			await sleep(options.batchDelayMs)
		}
	}

	return merged
}

export async function createGroupWithParticipants(
	client: Client,
	groupName: string,
	phoneNumbers: string[],
	options: CreateGroupOptions = {},
): Promise<CreateGroupResult> {
	const batch = normalizeBatchOptions(options)
	const inputs = await resolveParticipantInputs(client, phoneNumbers)
	const validIds = inputs
		.filter((p) => p.contactId)
		.map((p) => pickParticipantApiId(p.contactId!, p.lookupIds))

	if (!validIds.length) {
		const participants = mapWaParticipantResults(inputs)
		throw new GroupValidationError('Tidak ada nomor valid yang terdaftar di WhatsApp', participants)
	}

	const createIds = validIds.slice(0, batch.batchSize)
	const remainingIds = validIds.slice(batch.batchSize)

	const messageMode = options.messageMode === 'admins_only' ? 'admins_only' : 'all'

	const createResult = await client.createGroup(groupName, createIds, {
		autoSendInviteV4: true,
		comment: options.inviteComment || '',
		announce: createGroupAnnounceFlag(messageMode),
	} as Parameters<Client['createGroup']>[2])

	if (isCreateGroupError(createResult)) {
		throw new Error(createResult)
	}

	const groupId = createResult.gid._serialized
	let waParticipants: Record<string, unknown> = { ...createResult.participants }

	if (remainingIds.length) {
		await sleep(batch.batchDelayMs)
		const added = await addParticipantBatches(client, groupId, remainingIds, batch)
		waParticipants = { ...waParticipants, ...added }
	}

	let participants = mapWaParticipantResults(inputs, waParticipants)

	const unresolved = participants.filter(
		(p) => p.status === 'failed' && p.message.includes('coba undang manual'),
	)
	if (unresolved.length) {
		const retryIds = inputs
			.filter((input) => unresolved.some((p) => p.phone === input.formatted))
			.map((p) => pickParticipantApiId(p.contactId!, p.lookupIds))

		if (retryIds.length) {
			await sleep(batch.batchDelayMs)
			const retried = await addParticipantBatches(client, groupId, retryIds, batch)
			participants = mapWaParticipantResults(inputs, { ...waParticipants, ...retried })
		}
	}

	const settings = await applyGroupSettingsAfterCreate(client, groupId, validIds, {
		messageMode,
		promoteMembersToAdmin: options.promoteMembersToAdmin,
	})

	return {
		groupId,
		groupName,
		participants,
		summary: summarizeParticipants(participants),
		settings,
	}
}

export interface LeaveGroupResult {
	groupId: string
	groupName: string
}

export async function leaveGroup(client: Client, groupId: string): Promise<LeaveGroupResult> {
	const chat = await getGroupChat(client, groupId)
	const groupName = chat.name || groupId
	await chat.leave()
	try {
		await chat.delete()
	} catch (error) {
		console.warn(`[WA Group] delete chat after leave failed (${groupId}):`, error)
	}
	return { groupId, groupName }
}

export async function addParticipantsToGroup(
	client: Client,
	groupId: string,
	phoneNumbers: string[],
	options: AddParticipantsOptions = {},
): Promise<AddParticipantsResult> {
	await assertBotInGroup(client, groupId)

	const batch = normalizeBatchOptions(options)
	const inputs = await resolveParticipantInputs(client, phoneNumbers)
	const validIds = inputs
		.filter((p) => p.contactId)
		.map((p) => pickParticipantApiId(p.contactId!, p.lookupIds))

	if (!validIds.length) {
		const participants = mapWaParticipantResults(inputs)
		throw new GroupValidationError('Tidak ada nomor valid yang terdaftar di WhatsApp', participants)
	}

	const waParticipants = await addParticipantBatches(client, groupId, validIds, batch)
	const participants = mapWaParticipantResults(inputs, waParticipants)

	return {
		groupId,
		participants,
		summary: summarizeParticipants(participants),
	}
}

export class GroupValidationError extends Error {
	participants: ParticipantOutcome[]

	constructor(message: string, participants: ParticipantOutcome[]) {
		super(message)
		this.name = 'GroupValidationError'
		this.participants = participants
	}
}
