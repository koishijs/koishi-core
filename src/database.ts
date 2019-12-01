import { Observed } from 'koishi-utils'
import { Activity } from './utils'

export interface Usage {
  last?: number
  count?: number
  date?: string
}

export enum UserFlag {
  ignore = 1,
}

export const userFlags: (keyof typeof UserFlag)[] = ['ignore']

export interface UserData {
  id: number
  name: string
  flag: number
  ignoreEnd: number
  authority: number
  usage: Record<string, Usage>
  talkativeness: Activity
}

export type User<K extends UserField = UserField> = Observed<Pick<UserData, K>>
export type UserField = keyof UserData
export const userFields: UserField[] = []

type UserGetter = (id: number, authority: number) => Partial<UserData>
const userGetters: UserGetter[] = []

export function extendUser (getter: UserGetter) {
  userGetters.push(getter)
  userFields.push(Object.keys(getter(0, 0)) as any)
}

extendUser((id, authority) => ({
  id,
  authority,
  flag: 0,
  ignoreEnd: 0,
  name: String(id),
  usage: {},
  talkativeness: {},
}))

export function createUser (id: number, authority: number) {
  const result = {} as UserData
  for (const getter of userGetters) {
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
export const groupFields: GroupField[] = []

type GroupGetter = (id: number, assignee: number) => Partial<GroupData>
const groupGetters: GroupGetter[] = []

export function extendGroup (getter: GroupGetter) {
  groupGetters.push(getter)
}

extendGroup((id, assignee) => ({
  id,
  assignee,
  flag: assignee ? 0 : 3,
}))

export function createGroup (id: number, assignee: number) {
  const result = {} as GroupData
  for (const getter of groupGetters) {
    Object.assign(result, getter(id, assignee))
  }
  return result
}

export interface Database extends Subdatabases {
  // user methods
  getUser <K extends UserField> (userId: number, defaultAuthority?: number, keys?: K[]): Promise<Pick<UserData, K>>
  getUsers <K extends UserField> (ids: number[], keys?: UserField[]): Promise<Pick<UserData, K>[]>
  getAllUsers <K extends UserField> (keys?: K[]): Promise<Pick<UserData, K>[]>
  setUser (userId: number, data: Partial<UserData>): Promise<any>
  observeUser <K extends UserField> (user: number | UserData, defaultAuthority?: number, keys?: K[]): Promise<User<K>>
  getUserCount (): Promise<number>

  // group methods
  getGroup <K extends GroupField> (groupId: number, selfId?: number, keys?: K[]): Promise<Pick<GroupData, K>>
  getAllGroups <K extends GroupField> (keys?: K[], assignees?: number[]): Promise<Pick<GroupData, K>[]>
  setGroup (groupId: number, data: Partial<GroupData>): Promise<any>
  getGroupCount (): Promise<number>
}

export interface DatabaseConfig {}

export interface Subdatabases {}

type SubdatabaseType = keyof Subdatabases

interface Subdatabase <K extends SubdatabaseType> {
  new (config: K extends keyof DatabaseConfig ? DatabaseConfig[K] : void): Subdatabases[K]
  _injections?: {}
}

const subdatabases: { [K in SubdatabaseType]: Subdatabase<K> } = {}

export function registerSubdatabase <K extends SubdatabaseType> (name: K, subdatabase: Subdatabase<K>) {
  subdatabases[name] = subdatabase as any
  subdatabase._injections = {}
}

type DatabaseInjections <K extends SubdatabaseType> = {
  [M in Exclude<keyof Database, SubdatabaseType>]?:
    Database[M] extends (...args: infer P) => infer R ? (this: DatabaseInjections<K> & Subdatabases[K], ...args: P) => R : never
}

export function injectMethods <K extends SubdatabaseType> (name: K, methods: DatabaseInjections<K>) {
  Object.assign((subdatabases[name] as Subdatabase<K>)._injections, methods)
}

export function createDatabase (config: DatabaseConfig) {
  const database = {} as Database
  for (const type in subdatabases) {
    if (!config[type]) return
    const injections = subdatabases[type]._injections
    const subdatabase = database[type] = new subdatabases[type](config[type])
    for (const name in injections) {
      subdatabase[name] = database[name] = injections[name].bind(subdatabase)
    }
  }
  return database
}
