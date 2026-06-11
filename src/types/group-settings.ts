/** Who can send messages in the group. */
export type GroupMessageMode = 'all' | 'admins_only'

export interface CreateGroupSettingsOptions {
	messageMode?: GroupMessageMode
	promoteMembersToAdmin?: boolean
}

export interface AppliedGroupSettings {
	messageMode: GroupMessageMode
	membersCanSendMessages: boolean
	membersPromotedToAdmin: boolean
	promoteFailed: boolean
}
