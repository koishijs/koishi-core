import debug from 'debug'
import escapeRegex from 'escape-string-regexp'
import { Server, createServer } from './server'
import { Sender } from './sender'
import { UserContext, UserOptions } from './user'
import { GroupContext, GroupOptions } from './group'
import { DiscussContext, DiscussOptions } from './discuss'
import { Context, Middleware, isAncestor, NextFunction } from './context'
import { Command, ShortcutConfig, ParsedCommandLine } from './command'
import { Database, GroupFlag, UserFlag, UserField, createDatabase, DatabaseConfig } from './database'
import { updateActivity, showSuggestions } from './utils'
import { simplify } from 'koishi-utils'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface AppOptions {
  port?: number
  name?: string
  token?: string
  secret?: string
  sendURL?: string
  selfId?: number
  wsServer?: string
  database?: DatabaseConfig
}

const defaultOptions: AppOptions = {
  port: 8080,
  sendURL: 'http://127.0.0.1:5700',
}

const showLog = debug('koishi')
export const selfIds: number[] = []
export const apps: Record<number, App> = {}

export function createApp (options: AppOptions = {}) {
  const app = new App(options)
  apps[options.selfId] = app
  selfIds.push(options.selfId)
  return app
}

export function eachApp (callback: (app: App) => any) {
  for (const id in apps) {
    callback(apps[id])
  }
}

const onStartHooks = new Set<(...app: App[]) => void>()

export function onStart (hook: (...app: App[]) => void) {
  onStartHooks.add(hook)
}

export function startAll () {
  const appList: App[] = []
  for (const id in apps) {
    apps[id].start()
    appList.push(apps[id])
  }
  for (const hook of onStartHooks) {
    hook(...appList)
  }
}

export function stopAll () {
  for (const id in apps) {
    apps[id].stop()
  }
}

export class App extends Context {
  app = this
  server: Server
  options: AppOptions
  database: Database
  receiver: AppReceiver
  prefixRE: RegExp
  userPrefixRE: RegExp
  _commands: Command[] = []
  _commandMap: Record<string, Command> = {}
  _shortcuts: ShortcutConfig[] = []
  _shortcutMap: Record<string, Command> = {}
  _middlewares: [string, Middleware][] = []
  _contexts: Record<string, Context> = { '/': this }
  users = this._createContext('/user/')
  groups = this._createContext('/group/')
  discusses = this._createContext('/discuss/')

  constructor (options: AppOptions = {}) {
    super('/')
    this.options = { ...defaultOptions, ...options }
    if (options.database) this.database = createDatabase(options.database)
    if (options.port) this.server = createServer(this)
    this.sender = new Sender(this.options.sendURL, this.options.token, this.receiver)

    const atMeRE = `\\[CQ:at,qq=${this.app.options.selfId}\\]`
    if (this.app.options.name) {
      const nameRE = escapeRegex(this.app.options.name)
      this.prefixRE = new RegExp(`^(${atMeRE} *|@${nameRE} +|${nameRE}[,，\\s]+|\\.)`)
      this.userPrefixRE = new RegExp(`^(${nameRE}[,，\\s]+|\\.)`)
    } else {
      this.prefixRE = new RegExp(`^(${atMeRE} *|\\.)`)
      this.userPrefixRE = new RegExp('^\\.')
    }

    this.receiver.on('message', meta => this._applyMiddlewares(meta))
    this.middleware((meta, next) => this._preprocess(meta, next))
  }

  private _createContext <T extends Context> (path: string, create: () => T = () => new Context(path) as T) {
    if (!this._contexts[path]) {
      const ctx = this._contexts[path] = create()
      ctx.database = this.database
      ctx.sender = this.sender
      ctx.app = this
    }
    return this._contexts[path] as T
  }

  discuss (id: number, options: DiscussOptions = {}) {
    return this._createContext(`/discuss/${id}/`, () => new DiscussContext(id, options, this))
  }

  group (id: number, options: GroupOptions = {}) {
    return this._createContext(`/group/${id}/`, () => new GroupContext(id, options, this))
  }

  user (id: number, options: UserOptions = {}) {
    return this._createContext(`/user/${id}/`, () => new UserContext(id, options, this))
  }

  start () {
    this.sender.start()
    this.server.listen(this.options.port)
    showLog('started')
  }

  stop () {
    this.server.stop()
    this.sender.stop()
    showLog('stopped')
  }

  private async _preprocess (meta: Meta, next: NextFunction) {
    // strip prefix
    let message = meta.message.trim()
    let prefix = ''
    if (meta.messageType === 'group') {
      const capture = message.match(this.prefixRE)
      if (capture) {
        prefix = capture[0]
        message = message.slice(prefix.length)
      }
    } else {
      message = message.replace(this.userPrefixRE, '')
    }

    message = simplify(message)
    const fields: UserField[] = []
    let parsedArgv: ParsedCommandLine
    const canBeCommand = meta.messageType === 'private' || prefix
    const canBeShortcut = prefix !== '.'
    // parse as command
    if (canBeCommand && (parsedArgv = this._parseCommandLine(message, meta))) {
      fields.push(...parsedArgv.command._userFields)
    } else if (canBeShortcut) {
      // parse as shortcut
      for (const shortcut of this._shortcuts) {
        const { name, fuzzy, command, oneArg } = shortcut
        if (shortcut.prefix && !canBeCommand) continue
        if (!fuzzy && message !== name) continue
        if (message.startsWith(name)) {
          let _message = message.slice(name.length)
          if (fuzzy && !shortcut.prefix && _message.match(/^\S/)) continue
          if (oneArg) _message = `'${_message.trim()}'`
          const result = command.parse(_message)
          Object.assign(result.options, shortcut.options)
          fields.push(...command._userFields)
          parsedArgv = { meta, command, ...result }
          break
        }
      }
    }

    // generate fields
    if (!fields.includes('name')) fields.push('name')
    if (!fields.includes('flag')) fields.push('flag')
    if (!fields.includes('ignoreEnd')) fields.push('ignoreEnd')
    if (parsedArgv) {
      if (!fields.includes('usage')) fields.push('usage')
      if (!fields.includes('authority')) fields.push('authority')
    } else if (meta.messageType === 'group' && !fields.includes('talkativeness')) {
      fields.push('talkativeness')
    }

    if (this.database) {
      // attach user data
      const user = await this.app.database.observeUser(meta.userId, 0, fields)
      Object.defineProperty(meta, '$user', {
        value: user,
        writable: true,
      })

      // update talkativeness
      // ignore some group calls
      if (meta.messageType === 'group') {
        const isAssignee = meta.$group.assignee === this.options.selfId
        if (isAssignee && !parsedArgv) updateActivity(user.talkativeness, meta.groupId)
        const noCommand = meta.$group.flag & GroupFlag.noCommand
        const noResponse = meta.$group.flag & GroupFlag.noResponse || !isAssignee
        const originalNext = next
        next = (fallback?: NextFunction) => noResponse as never || originalNext(fallback)
        if (noCommand && parsedArgv) return
        if (noResponse && !prefix.includes(`[CQ:at,qq=${this.app.options.selfId}]`)) return
      }

      // ignore some user calls
      if (user.flag & UserFlag.ignore) return
      if (user.ignoreEnd) {
        const time = Date.now() / 1000
        if (user.ignoreEnd >= time) return
        user.ignoreEnd = 0
      }
    }

    // execute command
    if (parsedArgv) return parsedArgv.command.execute(parsedArgv, next)

    // show suggestions
    const target = message.split(/\s/, 1)[0].toLowerCase()
    if (!target || !canBeCommand) return next()

    return showSuggestions({
      target,
      meta,
      next,
      prefix: '没有此命令。',
      postfix: '发送空行以调用推测的指令。',
      items: Object.keys(this._commandMap),
      command: suggestion => this._commandMap[suggestion],
      execute: async (suggestion, meta, next) => {
        const newMessage = suggestion + message.slice(target.length)
        const parsedArgv = this._parseCommandLine(newMessage, meta)
        await this.app.database.observeUser(meta.$user, 0, Array.from(parsedArgv.command._userFields))
        return parsedArgv.command.execute(parsedArgv, next)
      },
    })
  }

  private _parseCommandLine (message: string, meta: Meta): ParsedCommandLine {
    const name = message.split(/\s/, 1)[0].toLowerCase()
    const command = this._commandMap[name]
    if (command && isAncestor(command.context.path, meta.$path)) {
      const result = command.parse(message.slice(name.length).trimStart())
      return { meta, command, ...result }
    }
  }

  private async _applyMiddlewares (meta: Meta) {
    const middlewares: Middleware[] = this._middlewares
      .filter(([path]) => isAncestor(path, meta.$path))
      .map(([_, middleware]) => middleware)

    // execute middlewares
    let index = -1
    await (async function next (fallback?: NextFunction) {
      ++index
      if (fallback) middlewares.push((_, next) => fallback(next))
      const middleware = middlewares[index]
      if (middleware) return middleware(meta, next)
    })()

    // flush user data
    if (meta.$user) await meta.$user._update()
  }
}

export type AppMetaEvent = 'message' | 'message/normal' | 'message/notice' | 'message/anonymous'
  | 'message' | 'message/friend' | 'message/group' | 'message/discuss' | 'message/other'
  | 'group_upload' | 'group_admin' | 'group_admin/unset' | 'group_admin/set'
  | 'group_increase' | 'group_increase/approve' | 'group_increase/invite'
  | 'group_decrease' | 'group_decrease/leave' | 'group_decrease/kick' | 'group_decrease/kick_me'
  | 'notice' | 'notice/friend_add' | 'request' | 'request/friend'
  | 'request/group' | 'request/group/add' | 'request/group/invite'
  | 'send' | 'send/group' | 'send/user' | 'send/discuss'

export type AppEvent = 'connected'

export interface AppReceiver extends EventEmitter {
  on (event: AppMetaEvent, listener: (meta: Meta) => any): this
  on (event: AppEvent, listener: (app: App) => any): this
  once (event: AppMetaEvent, listener: (meta: Meta) => any): this
  once (event: AppEvent, listener: (app: App) => any): this
}
