import { Observed } from 'koishi-utils'
import { Activity } from './utils'

export interface UserUsage {
  last?: number
  count?: number
  date?: string
}

export enum UserFlag {
  ignore = 1,
}

export const userFlags = ['ignore']

export interface UserData {
  id: number
  name: string
  flag: number
  ignoreEnd: number
  authority: number
  usage: Record<string, UserUsage>
  talkativeness: Activity
}

export type User = Observed<UserData>
export type UserField = keyof UserData

type DefaultUserGetter = (id: number, authority: number) => Record<UserField, any>

const defaultUserGetters: DefaultUserGetter[] = [(id, authority) => ({
  id,
  authority,
  flag: 0,
  ignoreEnd: 0,
  name: String(id),
  usage: {},
  talkativeness: {},
})]

export function extendUser (getter: DefaultUserGetter) {
  defaultUserGetters.push(getter)
}

export function getDefaultUser (id: number, authority: number) {
  const result = {} as UserData
  for (const getter of defaultUserGetters) {
    Object.assign(result, getter(id, authority))
  }
  return result
}

export interface GroupData {
  id: number
  flag: number
  assignee: number
}

export enum GroupFlag {
  noCommand = 1,
  noResponse = 2,
  noEmit = 4,
}

export type GroupField = keyof GroupData

export interface Database {
  // user methods
  getUser (userId: number, defaultAuthority?: number, keys?: UserField[]): Promise<UserData>
  getUsers (ids: number[], keys?: UserField[]): Promise<UserData[]>
  getAllUsers (keys?: UserField[]): Promise<UserData[]>
  setUser (userId: number, data: Partial<UserData>): Promise<any>
  observeUser (user: number | UserData, defaultAuthority?: number, keys?: UserField[]): Promise<User>

  // group methods
  getGroup (groupId: number, selfId?: number, keys?: GroupField[]): Promise<GroupData>
  getAllGroups (keys?: GroupField[], assignees?: number[]): Promise<GroupData[]>
  setGroup (groupId: number, data: Partial<GroupData>): Promise<any>
}

export function createDatabase (options) {
  return {} as Database
}
