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

export type UserEvent = 'message' | 'message/friend' | 'message/group' | 'message/discuss' | 'message/other'

export interface UserReceiver extends EventEmitter {
  on (event: UserEvent, listener: (meta: Meta) => any): this
  once (event: UserEvent, listener: (meta: Meta) => any): this
}
