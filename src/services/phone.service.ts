import type { Client } from 'whatsapp-web.js'
import { resolveNumberOnPage } from '@/bot/waStore.js'

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
	// Avoid Client.getNumberId — it crashes when Store.WidFactory is temporarily undefined.
	const resolved = await resolveNumberOnPage(client, formattedPhone)
	if (!resolved.ok) {
		if (resolved.error === 'not_registered') {
			return { error: `Nomor ${formattedPhone} tidak terdaftar di WhatsApp` }
		}
		if (resolved.error === 'store_not_ready') {
			return {
				error:
					'WhatsApp Store belum siap. Tunggu status ready (compat=on) atau POST /whatsapp/reconnect.',
			}
		}
		return { error: resolved.error || `Gagal resolve nomor ${formattedPhone}` }
	}

	const lookupIds = buildPhoneLookupIds(
		formattedPhone,
		resolved.contactId,
		...resolved.lookupIds,
	)

	return { contactId: resolved.contactId, lookupIds }
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
		contact: null as unknown,
	}
}
