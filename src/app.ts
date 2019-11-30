import escapeRegex from 'escape-string-regexp'
import { Server } from './server'
import { Sender } from './sender'
import { UserContext, UserOptions } from './user'
import { GroupContext, GroupOptions } from './group'
import { DiscussContext, DiscussOptions } from './discuss'
import { Context, Middleware, isAncestor, NextFunction } from './context'
import { Command, showCommandLog, ShortcutConfig, ParsedArgv } from './command'
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
  shareConnection?: boolean
  imageServerKey?: string
}

const defaultOptions: AppOptions = {
  port: 8080,
  sendURL: 'http://127.0.0.1:5700',
  shareConnection: true,
}

let database: Database

export class App extends Context {
  app = this
  server: Server
  options: AppOptions
  database: Database
  receiver: AppReceiver
  atMeRE: RegExp
  prefixRE: RegExp
  userPrefixRE: RegExp
  _commands: Command[] = []
  _commandMap: Record<string, Command> = {}
  _shortcuts: ShortcutConfig[] = []
  _shortcutMap: Record<string, Command> = {}
  _middlewares: [string, Middleware][] = []
  contexts: Record<string, Context> = { '/': this }
  users = this._context('/user/')
  groups = this._context('/group/')
  discusses = this._context('/discuss/')

  constructor (options: AppOptions = {}) {
    super('/')
    this.options = { ...defaultOptions, ...options }
    if (database && options.shareConnection) {
      this.database = database
    } else if (options.database) {
      database = this.database = createDatabase(options.database)
    }
    this.server = new Server(this)
    this.sender = new Sender(this.options.sendURL, this.options.token, this.receiver)
    const nameRE = escapeRegex(this.app.options.name)
    this.atMeRE = new RegExp(`^\\[CQ:at,qq=${this.app.options.selfId}\\]`)
    this.prefixRE = new RegExp(`^(\\[CQ:at,qq=${this.app.options.selfId}\\] *|@${nameRE} +|${nameRE}[,，\\s]+|\\.)`)
    this.userPrefixRE = new RegExp(`^${nameRE}[,，\\s]+`)

    this.receiver.on('message', meta => this._applyMiddlewares(meta))
    this.middleware((meta, next) => this._preprocess(meta, next))
  }

  private _context <T extends Context> (path: string, create: () => T = () => new Context(path) as T) {
    if (!this.contexts[path]) {
      const ctx = this.contexts[path] = create()
      ctx.database = this.database
      ctx.sender = this.sender
      ctx.app = this
    }
    return this.contexts[path] as T
  }

  discuss (id: number, options: DiscussOptions = {}) {
    return this._context(`/discuss/${id}/`, () => new DiscussContext(id, options, this))
  }

  group (id: number, options: GroupOptions = {}) {
    return this._context(`/group/${id}/`, () => new GroupContext(id, options, this))
  }

  user (id: number, options: UserOptions = {}) {
    return this._context(`/user/${id}/`, () => new UserContext(id, options, this))
  }

  start () {
    this.sender.start()
    this.server.listen(this.options.port)
  }

  close () {
    this.server.close()
    this.sender.close()
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
    let parsedArgv: ParsedArgv
    const canBeCommand = meta.messageType === 'private' || prefix
    const canBeShortcut = prefix !== '.'
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
          const { args, options: parsedOptions, rest, unknown } = command.parseLine(_message)
          const options = { ...parsedOptions, ...shortcut.options }
          fields.push(...command._userFields)
          parsedArgv = { name, meta, message, options, args, command }
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
    if (parsedArgv) {
      parsedArgv.next = next
      return parsedArgv.command.run(parsedArgv)
    }

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
      execute (suggestion, meta) {
        const newMessage = suggestion + message.slice(target.length)
        const parsedArgv = this._parseCommandLine(newMessage, meta)
        return parsedArgv.command.run(parsedArgv)
      },
    })
  }

  _registerCommand (name: string, command: Command) {
    const previous = this._commandMap[name]
    if (!previous) {
      this._commandMap[name] = command
    } else if (previous !== command) {
      throw new Error('duplicate command names')
    }
  }

  _parseCommandLine (message: string, meta: Meta): ParsedArgv {
    const name = message.split(/\s/, 1)[0].toLowerCase()
    const command = this._commandMap[name]
    if (command && isAncestor(command.context.path, meta.$path)) {
      // parse as command
      showCommandLog('command: %s', name)
      message = message.slice(name.length).trimStart()
      const { options, unknown, rest, args } = command.parseLine(message)
      return { name, meta, message, options, args, command }
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
