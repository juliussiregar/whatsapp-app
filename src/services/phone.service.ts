import type { Client } from 'whatsapp-web.js'

function widToSerialized(wid: unknown): string | null {
	if (!wid) return null
	if (typeof wid === 'string') return wid
	if (typeof wid === 'object') {
		const w = wid as {
			_serialized?: string
			$1?: string
			user?: string
			server?: string
		}
		if (w._serialized) return w._serialized
		if (w.$1) return w.$1
		if (w.user && w.server) return `${w.user}@${w.server}`
	}
	return null
}

export function formatPhoneNumber(phoneNumber: string): string {
	let formatted = phoneNumber.trim().replaceAll(/\D/g, '')
	if (formatted.startsWith('0')) {
		formatted = '62' + formatted.substring(1)
	} else if (!formatted.startsWith('62') && formatted.length <= 10) {
		formatted = '62' + formatted
	}
	return formatted
}

export function buildPhoneLookupIds(formattedPhone: string, ...ids: Array<string | null | undefined>) {
	const unique = new Set<string>()
	for (const id of ids) {
		if (id) unique.add(id)
	}
	unique.add(`${formattedPhone}@c.us`)
	unique.add(`${formattedPhone}@s.whatsapp.net`)
	return [...unique]
}

/** Prefer phone/@c.us for APIs that need PN; keep lid in lookup for send retries. */
export function pickParticipantApiId(contactId: string, lookupIds: string[]) {
	return (
		lookupIds.find((id) => id.endsWith('@c.us')) ||
		lookupIds.find((id) => id.endsWith('@s.whatsapp.net')) ||
		contactId
	)
}

/** Order that often works after WhatsApp LID migration: lid → c.us → others. */
export function sendCandidateIds(contactId: string, lookupIds: string[]): string[] {
	const ordered: string[] = []
	const push = (id?: string) => {
		if (id && !ordered.includes(id)) ordered.push(id)
	}
	for (const id of lookupIds) {
		if (id.endsWith('@lid')) push(id)
	}
	push(contactId)
	for (const id of lookupIds) {
		if (id.endsWith('@c.us') || id.endsWith('@s.whatsapp.net')) push(id)
	}
	for (const id of lookupIds) push(id)
	return ordered
}

export async function resolveWhatsAppContactId(
	client: Client,
	formattedPhone: string,
): Promise<{ contactId: string; lookupIds: string[] } | { error: string }> {
	const numberId = await client.getNumberId(formattedPhone)
	const primaryId = widToSerialized(numberId)
	if (!primaryId) {
		return { error: `Nomor ${formattedPhone} tidak terdaftar di WhatsApp` }
	}

	let lookupIds = buildPhoneLookupIds(formattedPhone, primaryId)

	try {
		const [lidPn] = await client.getContactLidAndPhone([primaryId])
		const lid =
			widToSerialized(lidPn?.lid) ||
			(typeof lidPn?.lid === 'string' ? lidPn.lid : null)
		const pn =
			widToSerialized(lidPn?.pn) ||
			(typeof lidPn?.pn === 'string' ? lidPn.pn : null)
		if (lid || pn) {
			lookupIds = buildPhoneLookupIds(formattedPhone, primaryId, lid, pn)
		}
	} catch {
		// LID lookup is best-effort; phone id still works for most accounts.
	}

	return { contactId: primaryId, lookupIds }
}

/** Used by personal message routes — throws on invalid contact. */
export async function getValidatedContact(client: Client, formattedPhone: string) {
	const result = await resolveWhatsAppContactId(client, formattedPhone)
	if ('error' in result) {
		throw new Error(result.error)
	}
	return {
		contactId: result.contactId,
		lookupIds: result.lookupIds,
		contact: await client
			.getContactById(pickParticipantApiId(result.contactId, result.lookupIds))
			.catch(() => null),
	}
}
