import type { Client } from 'whatsapp-web.js'

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

/** Prefer @c.us / phone wid for group APIs; fall back to primary contact id. */
export function pickParticipantApiId(contactId: string, lookupIds: string[]) {
	return (
		lookupIds.find((id) => id.endsWith('@c.us')) ||
		lookupIds.find((id) => id.endsWith('@s.whatsapp.net')) ||
		contactId
	)
}

export async function resolveWhatsAppContactId(
	client: Client,
	formattedPhone: string,
): Promise<{ contactId: string; lookupIds: string[] } | { error: string }> {
	const numberId = await client.getNumberId(formattedPhone)
	if (!numberId?._serialized) {
		return { error: `Nomor ${formattedPhone} tidak terdaftar di WhatsApp` }
	}

	const primaryId = numberId._serialized
	let lookupIds = buildPhoneLookupIds(formattedPhone, primaryId)

	try {
		const [lidPn] = await client.getContactLidAndPhone([primaryId])
		if (lidPn?.lid || lidPn?.pn) {
			lookupIds = buildPhoneLookupIds(formattedPhone, primaryId, lidPn.lid, lidPn.pn)
		}
	} catch {
		// LID lookup is best-effort; phone id still works for most accounts.
	}

	const apiId = pickParticipantApiId(primaryId, lookupIds)
	const contact = await client.getContactById(apiId)
	if (!contact) {
		return { error: `Kontak tidak ditemukan untuk ${formattedPhone}` }
	}

	return { contactId: primaryId, lookupIds }
}

/** Used by personal message routes — throws on invalid contact. */
export async function getValidatedContact(client: Client, formattedPhone: string) {
	const result = await resolveWhatsAppContactId(client, formattedPhone)
	if ('error' in result) {
		throw new Error(result.error)
	}
	return { contactId: result.contactId, contact: await client.getContactById(result.contactId) }
}
