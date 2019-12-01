import { Command, CommandConfig } from './command'
import { EventEmitter } from 'events'
import { Meta } from './meta'
import { Sender } from './sender'
import { App } from './app'
import { Database } from './database'
import * as messages from './messages'
import * as errors from './errors'

export type NextFunction = (next?: NextFunction) => void | Promise<void>
export type Middleware = (meta: Meta, next: NextFunction) => void | Promise<void>
export type Plugin <T extends Context, U = {}> = ((ctx: T, options: U) => void) | { apply (ctx: T, options: U): void }

export function isAncestor (ancestor: string, path: string) {
  return path.startsWith(ancestor) || path.replace(/\d+/, '*').startsWith(ancestor)
}

export const prefixTypes = ['user', 'discuss', 'group']

export class Context {
  public sender: Sender
  public database: Database
  public receiver = new EventEmitter()

  constructor (public path: string, public app?: App) {}

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

  private _getChildCommand (name: string, parent?: Command) {
    let command = this.app._commandMap[name]
    if (command) {
      if (parent && command.parent !== parent) {
        throw new Error(errors.WRONG_SUBCOMMAND)
      }
      if (!isAncestor(command.context.path, this.path)) {
        throw new Error(errors.WRONG_CONTEXT)
      }
      return command
    }
    if (parent && !isAncestor(parent.context.path, this.path)) {
      throw new Error(errors.WRONG_CONTEXT)
    }
    command = new Command(name, this)
    if (parent) {
      command.parent = parent
      parent.children.push(command)
    }
    return command
  }

  command (rawName: string, config?: CommandConfig): Command
  command (rawName: string, description: string, config?: CommandConfig): Command
  command (rawName: string, ...args: [CommandConfig?] | [string, CommandConfig?]) {
    const description = typeof args[0] === 'string' ? args.shift() as string : undefined
    const config = { description, ...args[0] as CommandConfig }

    const [name] = rawName.split(/\s/, 1)
    const declaration = rawName.slice(name.length)
    const segments = name.split(/(?=[\\./])/)
    let command: Command
    segments.forEach((name, index) => {
      if (index === segments.length - 1) name += declaration
      if (!index) return command = this._getChildCommand(name)
      if (name.charCodeAt(0) === 46) {
        command = this._getChildCommand(command.name + name, command)
      } else {
        command = this._getChildCommand(name.slice(1), command)
      }
    })

    Object.assign(command.config, config)
    return command
  }

  getCommand (name: string, meta?: Meta) {
    name = name.split(' ', 1)[0]
    const path = meta ? meta.$path : this.path
    const command = this.app._commandMap[name]
    return command && isAncestor(command.context.path, path) && command
  }

  runCommand (name: string, meta: Meta, args: string[] = [], options: Record<string, any> = {}, rest = '') {
    const command = this.app._commandMap[name]
    if (!command || !isAncestor(command.context.path, meta.$path)) {
      meta.$send(messages.COMMAND_NOT_FOUND)
    }
    return command.execute({ meta, command, args, options, rest, unknown: [] })
  }

  end () {
    return this.app
  }

  _getEventTypes (path: string) {
    if (path.startsWith(this.path)) {
      let lastEvent = ''
      const events: string[] = []
      for (let segment of path.slice(this.path.length).split('/')) {
        if (!isNaN(segment as any) || prefixTypes.includes(segment)) segment = lastEvent ? '*' : ''
        if (segment) events.push(lastEvent = lastEvent ? `${lastEvent}/${segment}` : segment)
      }
      return events
    } else {
      return []
    }
  }
}
