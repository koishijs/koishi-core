import { Context } from './context'
import { App } from './app'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface UserOptions {}

export class UserContext extends Context {
  receiver: UserReceiver

  constructor (public id: number, public options: UserOptions, app: App) {
    super(`/user/${id}/`, app)
  }
}

export type UserMessageEvent = 'message' | 'message/friend' | 'message/group' | 'message/discuss' | 'message/other'
export type UserNoticeEvent = 'friend_add'
export type UserRequestEvent = 'request'

export interface UserReceiver extends EventEmitter {
  on (event: UserNoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  on (event: UserMessageEvent, listener: (meta: Meta<'message'>) => any): this
  on (event: UserRequestEvent, listener: (meta: Meta<'request'>) => any): this
  once (event: UserNoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  once (event: UserMessageEvent, listener: (meta: Meta<'message'>) => any): this
  once (event: UserRequestEvent, listener: (meta: Meta<'request'>) => any): this
}
