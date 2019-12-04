import { GroupData, User } from './database'

export type PostType = 'message' | 'notice' | 'request' | 'meta_event'

export interface MetaTypeMap {
  message: 'private' | 'group' | 'discuss'
  notice: 'group_upload' | 'group_admin' | 'group_increase' | 'group_decrease' | 'group_ban' | 'friend_add'
  request: 'friend' | 'group'
  // eslint-disable-next-line camelcase
  meta_event: 'lifecycle' | 'heartbeat'
}

export interface SubTypeMap {
  message: 'friend' | 'group' | 'discuss' | 'other' | 'normal' | 'anonymous' | 'notice'
  notice: 'set' | 'unset' | 'approve' | 'invite' | 'leave' | 'kick' | 'kick_me' | 'ban' | 'lift_ban'
  request: 'add' | 'invite'
  // eslint-disable-next-line camelcase
  meta_event: 'enable' | 'disable'
}

export type MessageMeta = Meta<'message'>

/** CQHTTP Meta Information */
export interface Meta <T extends PostType = PostType> {
  $path?: string
  $user?: User
  $group?: GroupData
  $send?: (message: string) => Promise<number>
  postType?: T
  messageType?: MetaTypeMap[T & 'message']
  noticeType?: MetaTypeMap[T & 'notice']
  requestType?: MetaTypeMap[T & 'request']
  metaEventType?: MetaTypeMap[T & 'meta_event']
  subType?: SubTypeMap[T]
  messageId?: number
  userId?: number
  selfId?: number
  groupId?: number
  discussId?: number
  operatorId?: number
  message?: string
  rawMessage?: string
  font?: number
  sender?: SenderInfo
  anonymous?: AnonymousInfo
  file?: FileInfo
  comment?: string
  flag?: string
  time?: number
}

export interface AnonymousInfo {
  id: number
  name: string
  flag: string
}

export interface FileInfo {
  id: string
  name: string
  size: number
  busid: number
}

export interface AccountInfo {
  userId: number
  nickname: string
}

export interface FriendInfo extends AccountInfo {
  remark: string
}

export interface StrangerInfo extends AccountInfo {
  sex: 'male' | 'female' | 'unknown'
  age: number
}

export interface SenderInfo extends StrangerInfo {
  area?: string
  card?: string
  level?: string
  role?: 'owner' | 'admin' | 'member'
  title?: string
}

export interface GroupMemberInfo extends SenderInfo {
  cardChangeable: boolean
  groupId: number
  joinTime: number
  lastSentTime: number
  titleExpireTime: number
  unfriendly: boolean
}

export interface ListedGroupInfo {
  groupId: number
  groupName: string
}

export interface GroupInfo extends ListedGroupInfo {
  memberCount: number
  maxMemberCount: number
}

export interface Credentials {
  cookies: string
  csrfToken: number
}

export interface StatusInfo {
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
