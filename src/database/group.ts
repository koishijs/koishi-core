import { Database, joinKeys, formatValues } from './database'
import { assignees as assigneeIds } from '../manager'
import { isSubset } from 'koishi-utils'

declare module './database' {
  interface Database {
    getGroup (groupId: number | '*', selfId?: number, keys?: GroupField[]): Promise<GroupData>
    getAllGroups (keys?: GroupField[], assignees?: number[]): Promise<GroupData[]>
    setGroup (groupId: number, data: Partial<GroupData>): Promise<OkPacket>
  }
}

export interface GroupData {
  id: number
  flag: number
  assignee: number
  records: [string, string][][]
  subscribe: Record<string, number[]>
}

export enum GroupFlag {
  noCommand = 1,
  noResponse = 2,
  noEmit = 4,
  isRecording = 16,
}

const getDefaultGroupData = (id: number, assignee: number): GroupData => ({
  id,
  assignee,
  flag: assignee ? 0 : 3,
  records: [],
  subscribe: {},
})

type GroupField = keyof GroupData
type CachedGroupData = GroupData & { _timestamp: number }

const GROUP_REFRESH_INTERVAL = 60 * 1000
const groupCache: Record<number, CachedGroupData> = {}
const groupDataKeys = Object.keys(getDefaultGroupData(0, 0)) as GroupField[]

Database.prototype.getGroup = async function (groupId: number | '*', selfId = 0, keys: GroupField[] = groupDataKeys) {
  if (groupId === '*') groupId = 0
  const timestamp = Date.now()
  const cache = groupCache[groupId]
  if (cache && isSubset(keys, Object.keys(cache)) && timestamp - cache._timestamp < GROUP_REFRESH_INTERVAL) {
    return cache
  }

  const [data] = await this.query('SELECT ' + joinKeys(keys) + ' FROM `groups` WHERE `id` = ?', [groupId]) as GroupData[]
  let fallback: GroupData
  if (!data) {
    fallback = getDefaultGroupData(groupId, selfId)
    if (selfId && groupId) {
      await this.query(
        'INSERT INTO `groups` (' + joinKeys(groupDataKeys) + ') VALUES (' + groupDataKeys.map(() => '?').join(', ') + ')',
        formatValues('groups', fallback, groupDataKeys),
      )
    }
  } else {
    data.id = groupId
  }

  const group = groupCache[groupId] = (data || fallback) as CachedGroupData
  Object.defineProperty(group, '_timestamp', { value: timestamp })
  return group
}

Database.prototype.getAllGroups = async function (keys: GroupField[] = groupDataKeys, assignees = assigneeIds) {
  let queryString = 'SELECT ' + joinKeys(keys) + ' FROM `groups`'
  if (assignees) queryString += ` WHERE \`assignee\` IN (${assignees.join(',')})`
  return await this.query(queryString) as GroupData[]
}

Database.prototype.setGroup = async function (groupId: number, data: Partial<GroupData>) {
  const result = await this.update('groups', groupId, data)
  if (!groupCache[groupId]) {
    groupCache[groupId] = {} as CachedGroupData
    Object.defineProperty(groupCache[groupId], '_timestamp', { value: Date.now() })
  }
  Object.assign(groupCache[groupId], data)
  return result
}
