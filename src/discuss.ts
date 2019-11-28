import Context from './context'
import { App } from './app'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface DiscussOptions {}

export default class DiscussContext extends Context {
  constructor (public id: number, public options: DiscussOptions, app: App) {
    super(`/discuss/${id}/`, app)
  }
}

export type DiscussEvent = 'message'

export interface DiscussReceiver extends EventEmitter {
  on (event: DiscussEvent, listener: (meta: Meta) => any): this
  once (event: DiscussEvent, listener: (meta: Meta) => any): this
}
