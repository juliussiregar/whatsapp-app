import type { AppliedGroupSettings } from '@/types/group-settings.js'

/** Normalized outcome for one phone number in group create / invite flows. */
export type ParticipantStatus = 'added' | 'invited' | 'failed' | 'skipped'

export interface ParticipantInput {
	raw: string
	formatted: string
	/** Primary WhatsApp ID from QueryExist (may be @c.us or @lid). */
	contactId: string | null
	/** All known aliases — used to match createGroup / addParticipants result keys. */
	lookupIds: string[]
	error: string | null
}

export interface ParticipantOutcome {
	phone: string
	contactId: string | null
	status: ParticipantStatus
	statusCode: number | null
	message: string
}

export interface BatchOptions {
	batchSize: number
	batchDelayMs: number
}

export interface GroupMutationSummary {
	added: number
	invited: number
	failed: number
	skipped: number
}

export interface CreateGroupResult {
	groupId: string
	groupName: string
	participants: ParticipantOutcome[]
	summary: GroupMutationSummary
	settings: AppliedGroupSettings
}

export interface AddParticipantsResult {
	groupId: string
	participants: ParticipantOutcome[]
	summary: GroupMutationSummary
}
