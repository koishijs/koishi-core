import { Context } from './context'
import { App } from './app'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface DiscussOptions {}

export class DiscussContext extends Context {
  receiver: DiscussReceiver

  constructor (public id: number, public options: DiscussOptions, app: App) {
    super(`/discuss/${id}/`, app)
  }
}

export type DiscussMessageEvent = 'message'

export interface DiscussReceiver extends EventEmitter {
  on (event: DiscussMessageEvent, listener: (meta: Meta) => any): this
  once (event: DiscussMessageEvent, listener: (meta: Meta) => any): this
}
