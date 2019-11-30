import { Command, CommandConfig, ParsedArgv } from './command'
import { EventEmitter } from 'events'
import { Meta } from './meta'
import { Sender } from './sender'
import { App } from './app'
import { Database } from './database'

export type NextFunction = (next?: NextFunction) => void | Promise<void>
export type Middleware = (meta: Meta, next: NextFunction) => void | Promise<void>
export type Plugin <T extends Context, U = {}> = ((ctx: T, options: U) => void) | { apply (ctx: T, options: U): void }

export function isAncestor (ancestor: string, path: string) {
  return path.startsWith(ancestor) || path.replace(/\d+/, '*').startsWith(ancestor)
}

export const MESSAGE_COMMAND_NOT_FOUND = '指令未找到。'
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

  command (name: string, config?: CommandConfig): Command
  command (name: string, description: string, config?: CommandConfig): Command
  command (name: string, ...args: [CommandConfig?] | [string, CommandConfig?]) {
    const description = typeof args[0] === 'string' ? args.shift() as string : undefined
    const config = { description, ...args[0] as CommandConfig }
    let command = this.getCommand(name, this.path)
    if (command) {
      if (config) Object.assign(command.config, config)
      return command
    }
    command = new Command(name, this, config)
    this.app._commands.push(command)
    return command
  }

  getCommand (name: string, path?: string) {
    return this.app._commands.find(cmd => cmd.match(name, path))
  }

  runCommand (name: string, parsedArgv: ParsedArgv) {
    const command = this.app._commands.find(cmd => cmd.match(name, parsedArgv.meta.$path))
    if (command) return command.run(parsedArgv)
    return parsedArgv.meta.$send(MESSAGE_COMMAND_NOT_FOUND)
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
