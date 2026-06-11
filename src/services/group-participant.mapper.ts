import type { ParticipantInput, ParticipantOutcome, ParticipantStatus } from '@/types/group-participant.js'

interface WaParticipantResult {
	statusCode?: number
	message?: string
	isInviteV4Sent?: boolean
}

function normalizeWaResult(raw: unknown): WaParticipantResult | undefined {
	if (!raw || typeof raw !== 'object') return undefined

	const record = raw as Record<string, unknown>
	const statusCode =
		typeof record.statusCode === 'number'
			? record.statusCode
			: typeof record.code === 'number'
				? record.code
				: undefined

	if (statusCode === undefined && typeof record.message !== 'string') {
		return undefined
	}

	return {
		statusCode,
		message: typeof record.message === 'string' ? record.message : undefined,
		isInviteV4Sent: Boolean(record.isInviteV4Sent),
	}
}

function statusFromWaResult(result: WaParticipantResult | undefined): ParticipantStatus {
	if (!result || result.statusCode === undefined) return 'failed'
	if (result.statusCode === 200) {
		return result.isInviteV4Sent ? 'invited' : 'added'
	}
	if (result.statusCode === 403 && result.isInviteV4Sent) return 'invited'
	if (result.statusCode === 409) return 'added'
	return 'failed'
}

function phoneDigits(value: string) {
	return value.replace(/\D/g, '')
}

function findWaParticipantResult(
	input: ParticipantInput,
	waParticipants: Record<string, unknown>,
): WaParticipantResult | undefined {
	for (const id of input.lookupIds) {
		const hit = normalizeWaResult(waParticipants[id])
		if (hit) return hit
	}

	const digits = phoneDigits(input.formatted)
	if (!digits) return undefined

	for (const [key, value] of Object.entries(waParticipants)) {
		const keyDigits = phoneDigits(key)
		if (keyDigits && (keyDigits === digits || keyDigits.endsWith(digits) || digits.endsWith(keyDigits))) {
			const hit = normalizeWaResult(value)
			if (hit) return hit
		}
	}

	return undefined
}

export function mapWaParticipantResults(
	inputs: ParticipantInput[],
	waParticipants: Record<string, unknown> = {},
): ParticipantOutcome[] {
	return inputs.map((input) => {
		if (input.error || !input.contactId) {
			return {
				phone: input.formatted || input.raw,
				contactId: null,
				status: 'skipped',
				statusCode: null,
				message: input.error || 'Nomor tidak valid',
			}
		}

		const wa = findWaParticipantResult(input, waParticipants)
		const status = statusFromWaResult(wa)

		return {
			phone: input.formatted,
			contactId: input.contactId,
			status,
			statusCode: wa?.statusCode ?? null,
			message: wa?.message || defaultMessageForStatus(status),
		}
	})
}

export function summarizeParticipants(participants: ParticipantOutcome[]) {
	return {
		added: participants.filter((p) => p.status === 'added').length,
		invited: participants.filter((p) => p.status === 'invited').length,
		failed: participants.filter((p) => p.status === 'failed').length,
		skipped: participants.filter((p) => p.status === 'skipped').length,
	}
}

function defaultMessageForStatus(status: ParticipantStatus): string {
	switch (status) {
		case 'added':
			return 'Berhasil ditambahkan ke grup'
		case 'invited':
			return 'Undangan privat terkirim'
		case 'skipped':
			return 'Dilewati'
		default:
			return 'Gagal ditambahkan — coba undang manual lewat link grup'
	}
}
