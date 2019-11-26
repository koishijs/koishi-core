import { EventEmitter } from 'events'
import { Meta } from './meta'
import Command, { CommandConfig, ParsedArgv } from './command'
import Sender from './sender'
import { App } from './app'
import Database from './database'

export type NextFunction = (next?: NextFunction) => void | Promise<void>
export type Middleware = (meta: Meta, next: NextFunction) => void | Promise<void>

export type Plugin <T extends Context, U = {}> = ((ctx: T, options: U) => void) | { apply (ctx: T, options: U): void }

export function isAncestor (ancestor: string, path: string) {
  return path.startsWith(ancestor) || path.replace(/\d+/, '*').startsWith(ancestor)
}

export default class Context {
  public app: App
  public path: string
  public sender: Sender
  public database: Database
  public receiver = new EventEmitter()

  plugin <U> (plugin: Plugin<this, U>, options: U = {} as any) {
    const app = Object.create(this)
    if (typeof plugin === 'function') {
      plugin(app, options)
    } else if (plugin && typeof plugin === 'object' && typeof plugin.apply === 'function') {
      plugin.apply(app, options)
    }
    return this
  }

  middleware (middleware: Middleware, index = Infinity) {
    this.app._middlewares.splice(index, 0, [this.path, middleware])
    return this
  }

  removeMiddleware (middleware: Middleware) {
    const index = this.app._middlewares.findIndex(([p, m]) => p === this.path && m === middleware)
    if (index >= 0) {
      this.app._middlewares.splice(index, 1)
      return true
    }
  }

  command (name: string, description = '', config: CommandConfig = {}) {
    let command = this.getCommand(name)
    if (command) {
      if (description) command.description = description
      if (config) Object.assign(command._config, config)
      return command
    }
    command = new Command(name, description, this, config)
    let index = 0
    for (; index < this.app._commands.length; ++ index) {
      if (command.context.path < this.path) break
    }
    this.app._commands.splice(index, 0, command)
    this.app._commandMap[name] = command
    return command
  }

  getCommand (name: string, meta?: Meta) {
    return this.app._commands.find(cmd => cmd.match(name, meta))
  }

  runCommand (name: string, parsedArgv?: ParsedArgv) {
    const command = this.app._commands.find(cmd => cmd.match(name, parsedArgv.meta))
    if (command) return command.run(parsedArgv)
  }

  end () {
    return this.app
  }

  _getEventTypes (path: string) {
    if (path.startsWith(this.path)) {
      const segments = path.slice(this.path.length).split('/')
      return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
    } else {
      return []
    }
  }
}
