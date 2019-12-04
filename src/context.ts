import { Command, CommandConfig } from './command'
import { EventEmitter } from 'events'
import { MessageMeta } from './meta'
import { Sender } from './sender'
import { App } from './app'
import { Database } from './database'
import * as messages from './messages'
import * as errors from './errors'

export type NextFunction = (next?: NextFunction) => void | Promise<void>
export type Middleware = (meta: MessageMeta, next: NextFunction) => void | Promise<void>

type PluginFunction <T extends Context, U> = (ctx: T, options: U) => void
type PluginObject <T extends Context, U> = { apply: PluginFunction<T, U> }
export type Plugin <T extends Context, U> = PluginFunction<T, U> | PluginObject<T, U>

export function isAncestor (ancestor: string, path: string) {
  return path.startsWith(ancestor) || path.replace(/\d+/, '*').startsWith(ancestor)
}

export const prefixTypes = ['user', 'discuss', 'group']

export class Context {
  public sender: Sender
  public database: Database
  public receiver = new EventEmitter()

  constructor (public path: string, public app?: App) {}

  plugin <U> (plugin: PluginFunction<this, U>, options?: U): this
  plugin <U> (plugin: PluginObject<this, U>, options?: U): this
  plugin <U> (plugin: Plugin<this, U>, options: any) {
    if (options === false) return
    const app = Object.create(this)
    if (typeof plugin === 'function') {
      plugin(app, options)
    } else if (plugin && typeof plugin === 'object' && typeof plugin.apply === 'function') {
      plugin.apply(app, options)
    }
    return this
  }

  middleware (middleware: Middleware) {
    this.app._middlewares.push([this.path, middleware])
    return this
  }

  premiddleware (middleware: Middleware) {
    this.app._middlewares.unshift([this.path, middleware])
    return this
  }

  removeMiddleware (middleware: Middleware) {
    const index = this.app._middlewares.findIndex(([p, m]) => p === this.path && m === middleware)
    if (index >= 0) {
      this.app._middlewares.splice(index, 1)
      return true
    }
  }

  private _getCommandByParent (name: string, parent?: Command) {
    let command = this.app._commandMap[name.toLowerCase()]
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
      if (!index) return command = this._getCommandByParent(name)
      if (name.charCodeAt(0) === 46) {
        command = this._getCommandByParent(command.name + name, command)
      } else {
        command = this._getCommandByParent(name.slice(1), command)
      }
    })

    Object.assign(command.config, config)
    return command
  }

  private _getCommandByRawName (name: string) {
    name = name.split(' ', 1)[0]
    const index = name.lastIndexOf('/')
    return this.app._commandMap[name.slice(index + 1).toLowerCase()]
  }

  getCommand (name: string, meta?: MessageMeta) {
    const path = meta ? meta.$path : this.path
    const command = this._getCommandByRawName(name)
    return command && isAncestor(command.context.path, path) && command
  }

  runCommand (name: string, meta: MessageMeta, args: string[] = [], options: Record<string, any> = {}, rest = '') {
    const command = this._getCommandByRawName(name)
    if (!command || !isAncestor(command.context.path, meta.$path)) {
      return meta.$send(messages.COMMAND_NOT_FOUND)
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
