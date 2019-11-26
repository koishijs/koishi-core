import Context from './context'
import { App } from './app'

export interface UserOptions {}

export default class UserContext extends Context {
  constructor (public id: number, public options: UserOptions, public app: App) {
    super()
    this.path = `/user/${id}/`
    this.sender = app.sender
    this.database = app.database
  }
}

export class MultiUserContext extends UserContext {
  constructor (options: UserOptions, public app: App) {
    super('*' as any, options, app)
  }
}
