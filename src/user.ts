import Context from './context'
import { App } from './app'

export interface UserOptions {}

export default class UserContext extends Context {
  constructor (public id: number, public options: UserOptions, app: App) {
    super(`/user/${id}/`)
  }
}
