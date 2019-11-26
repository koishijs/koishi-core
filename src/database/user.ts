import { Database, joinKeys, formatValues, arrayTypes } from './database'
import { Observed, observe } from '../observer'
import { complement } from 'koishi-utils'
import { Activity } from '../utils'

declare module './database' {
  interface Database {
    getUser (userId: number, defaultAuthority?: number, keys?: UserField[]): Promise<UserData>
    getUsers (ids: number[], keys?: UserField[]): Promise<UserData[]>
    getAllUsers (keys?: UserField[]): Promise<UserData[]>
    setUser (userId: number, data: Partial<UserData>): Promise<OkPacket>
    observeUser (user: number | UserData, defaultAuthority?: number, keys?: UserField[]): Promise<User>
  }
}

export interface UserUsage {
  last?: number
  count?: number
  date?: string
}

export enum UserFlag {
  ignore = 1,
  dream = 64,
}

export const userFlags = ['ignore', 'dream']

export interface UserData {
  id: number
  name: string
  flag: number
  ignoreEnd: number
  authority: number
  money: number
  guessNumber: number
  achievement: string[]
  tags: [string, ...any[]][]
  usage: Record<string, UserUsage>
  talkativeness: Activity
  interactiveness: Activity
  progress: string
  endings: string[]
  inference: string[]
  warehouse: Record<string, number>
  lottery: {
    lucky: number
    noSR: number
    today: string[]
    hawthorn: number
  }
  solitaire: {
    fSuccess: number
    fTerminate: number
    bSuccess: number
    bTerminate: number
    pkTotal: number
    pkWin: number
    activity: Activity
  }
}

const getDefaultUserData = (id: number, defaultAuthority: number): UserData => ({
  id,
  flag: 0,
  money: 100,
  ignoreEnd: 0,
  name: String(id),
  guessNumber: 0,
  progress: '0',
  tags: [],
  authority: defaultAuthority,
  talkativeness: {},
  interactiveness: {},
  achievement: [],
  inference: [],
  usage: {},
  warehouse: {},
  endings: [],
  lottery: { lucky: 1, noSR: 0, today: [], hawthorn: 0 },
  solitaire: { fSuccess: 0, fTerminate: 0, bSuccess: 0, bTerminate: 0, pkTotal: 0, pkWin: 0, activity: {} },
})

export type UserField = keyof UserData
export type User = Observed<UserData>

const userDataKeys = Object.keys(getDefaultUserData(0, 0)) as UserField[]

arrayTypes.push('users.endings', 'users.achievement', 'users.inference')

Database.prototype.getUser = async function (this: Database, userId, defaultAuthority = 0, keys: UserField[] = userDataKeys) {
  const [data] = await this.query('SELECT ' + joinKeys(keys) + ' FROM `users` WHERE `id` = ?', [userId]) as UserData[]
  let fallback: UserData
  if (data) {
    data.id = userId
  } else if (defaultAuthority < 0) {
    return null
  } else {
    fallback = getDefaultUserData(userId, defaultAuthority)
    if (defaultAuthority) {
      await this.query(
        'INSERT INTO `users` (' + joinKeys(userDataKeys) + ') VALUES (' + userDataKeys.map(() => '?').join(', ') + ')',
        formatValues('users', fallback, userDataKeys),
      )
    }
  }
  return data || fallback
}

Database.prototype.getUsers = async function (this: Database, ids, keys = userDataKeys) {
  if (!ids.length) return []
  return await this.query(`SELECT ${joinKeys(keys)} FROM users WHERE id IN (${ids.join(', ')})`) as UserData[]
}

Database.prototype.getAllUsers = async function (this: Database, keys = userDataKeys) {
  return await this.query('SELECT ' + joinKeys(keys) + ' FROM `users`') as UserData[]
}

Database.prototype.setUser = async function (this: Database, userId, data) {
  return this.update('users', userId, data)
}

Database.prototype.observeUser = async function (this: Database, user, defaultAuthority = 0, fields = userDataKeys) {
  if (typeof user === 'number') {
    const data = await this.getUser(user, defaultAuthority, fields)
    return data && observe(data, `user ${user}`, diff => this.setUser(user, diff))
  } else {
    const additionalFields = complement(fields, Object.keys(user))
    const additionalData = additionalFields.length
      ? await this.getUser(user.id, defaultAuthority, complement(fields, Object.keys(user)))
      : {} as Partial<UserData>
    if ('_diff' in user) {
      return (user as User).merge(additionalData)
    } else {
      return observe(Object.assign(user, additionalData), `user ${user.id}`, diff => this.setUser(user.id, diff))
    }
  }
}
