import { GroupData, User } from './database'

export type MessageType = 'private' | 'group' | 'discuss'

/** CQHTTP Meta Information */
export interface Meta {
  $path?: string
  $user?: User
  $group?: GroupData
  $send?: (message: string) => Promise<void>
  postType?: 'message' | 'notice' | 'request'| 'meta_event'
  messageType?: MessageType
  subType?: 'friend' | 'group' | 'discuss' | 'other' | 'normal' | 'anonymous' | 'notice' | 'approve' | 'invite' | 'add' | 'enable' | 'disable'
  messageId?: number
  userId?: number
  selfId?: number
  message?: string
  rawMessage?: string
  font?: number
  sender?: GroupMember
  groupId?: number
  anonymous?: {
    id: number,
    name: string,
    flag: string,
  }
  discussId?: number
  noticeType?: 'group_upload' | 'group_admin' | 'group_increase' | 'friend_add'
  file?: {
    id: string,
    name: string,
    size: number,
    busid: number,
  }
  operatorId?: number
  requestType?: 'friend' | 'group'
  comment?: string
  flag?: string
  metaEventType?: 'lifecycle' | 'heartbeat'
  time?: number
}

export interface GroupMember {
  age?: number
  area?: string
  card?: string
  level?: string
  nickname?: string
  role?: 'owner' | 'admin' | 'member'
  sex?: 'male' | 'female' | 'unknown'
  title?: string
  userId?: number
}

export interface GroupMemberInfo extends GroupMember {
  cardChangeable: boolean
  groupId: number
  joinTime: number
  lastSentTime: number
  titleExpireTime: number
  unfriendly: boolean
}

export interface FriendInfo {
  userId: number
  nickname: string
  remark: string
}

export interface GroupInfo {
  groupId: number
  groupName: string
  memberCount: number
  maxMemberCount: number
}

export interface Credentials {
  cookies: string
  token: number
}

export interface Status {
  appInitialized: boolean
  appEnabled: boolean
  pluginsGood: boolean
  appGood: boolean
  online: boolean
  good: boolean
}

export interface VersionInfo {
  coolqDirectory: string
  coolqEdition: string
  pluginVersion: string
  pluginBuildNumber: number
  pluginBuildConfiguration: string
}
