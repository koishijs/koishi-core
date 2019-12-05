import debug from 'debug'
import escapeRegex from 'escape-string-regexp'
import { Server, createServer } from './server'
import { Sender } from './sender'
import { Context, UserContext, GroupContext, DiscussContext, Middleware, isAncestor, NextFunction, Plugin, NoticeEvent, RequestEvent, MetaEventEvent, MessageEvent } from './context'
import { Command, ShortcutConfig, ParsedCommandLine } from './command'
import { Database, GroupFlag, UserFlag, UserField, createDatabase, DatabaseConfig } from './database'
import { updateActivity, showSuggestions } from './utils'
import { simplify } from 'koishi-utils'
import { EventEmitter } from 'events'
import { Meta, MessageMeta } from './meta'
import * as errors from './errors'

export interface AppOptions {
  port?: number
  name?: string
  token?: string
  secret?: string
  sendUrl?: string
  selfId?: number
  wsServer?: string
  database?: DatabaseConfig
}

const showLog = debug('koishi')
const showReceiverLog = debug('koishi:receiver')

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
  database: Database
  receiver: AppReceiver
  prefixRE: RegExp
  userPrefixRE: RegExp

  _commands: Command[] = []
  _commandMap: Record<string, Command> = {}
  _shortcuts: ShortcutConfig[] = []
  _shortcutMap: Record<string, Command> = {}
  _middlewares: [string, Middleware][] = []

  private _middlewareCounter = 0
  private _middlewareSet = new Set<number>()
  private _contexts: Record<string, Context> = { '/': this }

  users = this._createContext<UserContext>('/user/')
  groups = this._createContext<GroupContext>('/group/')
  discusses = this._createContext<DiscussContext>('/discuss/')

  constructor (public options: AppOptions = {}) {
    super('/')
    if (options.database) this.database = createDatabase(options.database)
    if (options.port) this.server = createServer(this)
    if (options.selfId) this._registerSelfId()
    this.sender = new Sender(this)
    this.receiver.on('message', this._applyMiddlewares)
    this.middleware(this._preprocess)
  }

  _registerSelfId () {
    const atMeRE = `\\[CQ:at,qq=${this.options.selfId}\\]`
    if (this.app.options.name) {
      const nameRE = escapeRegex(this.app.options.name)
      this.prefixRE = new RegExp(`^(${atMeRE} *|@${nameRE} +|${nameRE}[,，\\s]+|\\.)`)
      this.userPrefixRE = new RegExp(`^(${nameRE}[,，\\s]+|\\.)`)
    } else {
      this.prefixRE = new RegExp(`^(${atMeRE} *|\\.)`)
      this.userPrefixRE = new RegExp('^\\.')
    }
  }

  _createContext <T extends Context> (path: string, id?: number) {
    if (!this._contexts[path]) {
      const ctx = this._contexts[path] = new Context(path, this)
      ctx.database = this.database
      ctx.sender = this.sender
      ctx.app = this
      ctx.id = id
    }
    return this._contexts[path] as T
  }

  discuss (id: number) {
    return this._createContext<DiscussContext>(`/discuss/${id}/`, id)
  }

  group (id: number) {
    return this._createContext<GroupContext>(`/group/${id}/`, id)
  }

  user (id: number) {
    return this._createContext<UserContext>(`/user/${id}/`, id)
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

  emitWarning (message: string) {
    this.receiver.emit('warning', new Error(message))
  }

  async handleMeta (meta: Meta) {
    Object.defineProperty(meta, '$path', {
      value: '/',
      writable: true,
    })
    if (meta.postType === 'message' || meta.postType === 'send') {
      const type = meta[meta.postType + 'Type']
      meta.$path += `${type === 'private' ? 'user' : type}/${meta.groupId || meta.discussId || meta.userId}/${meta.postType}`
    } else if (meta.postType === 'request') {
      meta.$path += `${meta.requestType === 'friend' ? 'user' : 'group'}/${meta.groupId || meta.userId}/request`
    } else if (meta.groupId) {
      meta.$path += `group/${meta.groupId}/${meta.noticeType}`
    } else if (meta.userId) {
      meta.$path += `user/${meta.userId}/${meta.noticeType}`
    } else {
      meta.$path += `meta_event/${meta.metaEventType}`
    }
    if (meta.subType) meta.$path += '/' + meta.subType
    showReceiverLog('path %s', meta.$path)

    // add context properties
    if (meta.postType === 'message') {
      if (meta.messageType === 'group') {
        if (this.database) {
          Object.defineProperty(meta, '$group', {
            value: await this.database.getGroup(meta.groupId),
            writable: true,
          })
        }
        meta.$send = message => this.sender.sendGroupMsg(meta.groupId, message)
      } else if (meta.messageType === 'discuss') {
        meta.$send = message => this.sender.sendDiscussMsg(meta.discussId, message)
      } else {
        meta.$send = message => this.sender.sendPrivateMsg(meta.userId, message)
      }
    }
  }

  emitMeta (meta: Meta) {
    for (const path in this._contexts) {
      const context = this._contexts[path]
      const types = context._getEventTypes(meta.$path)
      if (types.length) showReceiverLog(path, 'emits', types.join(', '))
      types.forEach(type => context.receiver.emit(type, meta))
    }
  }

  private _preprocess = async (meta: MessageMeta, next: NextFunction) => {
    // strip prefix
    if (!meta.message) console.log(meta)
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
        return parsedArgv.command.execute(parsedArgv, next)
      },
    })
  }

  private _parseCommandLine (message: string, meta: MessageMeta): ParsedCommandLine {
    const name = message.split(/\s/, 1)[0].toLowerCase()
    const command = this._commandMap[name]
    if (command && isAncestor(command.context.path, meta.$path)) {
      const result = command.parse(message.slice(name.length).trimStart())
      return { meta, command, ...result }
    }
  }

  private _applyMiddlewares = async (meta: MessageMeta) => {
    // preparation
    const counter = this._middlewareCounter++
    this._middlewareSet.add(counter)
    const middlewares: Middleware[] = this._middlewares
      .filter(([path]) => isAncestor(path, meta.$path))
      .map(([_, middleware]) => middleware)

    // execute middlewares
    let index = 0
    const initial = middlewares.indexOf(this._preprocess)
    const next = async (fallback?: NextFunction) => {
      if (!this._middlewareSet.has(counter)) {
        return this.emitWarning(errors.ISOLATED_NEXT)
      }
      if (fallback) middlewares.push((_, next) => fallback(next))
      const middleware = middlewares[index++]
      if (middleware) return middleware(meta, next)
    }
    await next()

    // update middleware set
    this._middlewareSet.delete(counter)
    if (index <= initial) {
      return this.emitWarning(errors.PREMIDDLEWARE_INTERCEPTION)
    }

    // flush user data
    if (meta.$user) await meta.$user._update()
  }
}

export interface AppReceiver extends EventEmitter {
  on (event: NoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  on (event: MessageEvent, listener: (meta: Meta<'message'>) => any): this
  on (event: RequestEvent, listener: (meta: Meta<'request'>) => any): this
  on (event: MetaEventEvent, listener: (meta: Meta<'meta_event'>) => any): this
  on (event: 'send', listener: (meta: Meta<'send'>) => any): this
  on (event: 'plugin', listener: (plugin: Plugin) => any): this
  on (event: 'warning', listener: (error: Error) => any): this
  on (event: 'connected', listener: (app: App) => any): this
  once (event: NoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  once (event: MessageEvent, listener: (meta: Meta<'message'>) => any): this
  once (event: RequestEvent, listener: (meta: Meta<'request'>) => any): this
  once (event: MetaEventEvent, listener: (meta: Meta<'meta_event'>) => any): this
  once (event: 'send', listener: (meta: Meta<'send'>) => any): this
  once (event: 'plugin', listener: (plugin: Plugin) => any): this
  once (event: 'warning', listener: (error: Error) => any): this
  once (event: 'connected', listener: (app: App) => any): this
}
