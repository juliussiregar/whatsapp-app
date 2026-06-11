import type { Client } from 'whatsapp-web.js'

import type { ParticipantInput } from '@/types/group-participant.js'
import { formatPhoneNumber, resolveWhatsAppContactId } from '@/services/phone.service.js'

export async function resolveParticipantInputs(
	client: Client,
	phoneNumbers: string[],
): Promise<ParticipantInput[]> {
	const unique = dedupeRawPhones(phoneNumbers)
	const results: ParticipantInput[] = []

	for (const raw of unique) {
		const formatted = formatPhoneNumber(raw)
		if (!formatted || formatted.length < 10) {
			results.push({
				raw,
				formatted,
				contactId: null,
				lookupIds: [],
				error: 'Format nomor tidak valid',
			})
			continue
		}

		const resolved = await resolveWhatsAppContactId(client, formatted)
		if ('error' in resolved) {
			results.push({
				raw,
				formatted,
				contactId: null,
				lookupIds: [],
				error: resolved.error,
			})
			continue
		}

		results.push({
			raw,
			formatted,
			contactId: resolved.contactId,
			lookupIds: resolved.lookupIds,
			error: null,
		})
	}

	return results
}

function dedupeRawPhones(phoneNumbers: string[]): string[] {
	const seen = new Set<string>()
	const ordered: string[] = []

	for (const phone of phoneNumbers) {
		const raw = phone.trim()
		if (!raw) continue
		const key = formatPhoneNumber(raw)
		if (seen.has(key)) continue
		seen.add(key)
		ordered.push(raw)
	}

	return ordered
}
