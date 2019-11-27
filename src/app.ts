import Server from './server'
import Sender from './sender'
import escapeRegex from 'escape-string-regexp'
import Database, { GroupFlag, UserFlag, UserField } from './database'
import UserContext, { UserOptions, MultiUserContext } from './user'
import GroupContext, { GroupOptions, MultiGroupContext } from './group'
import Context, { Middleware, isAncestor, NextFunction } from './context'
import Command, { showCommandLog, ShortcutConfig, ParsedArgv } from './command'
import { splitMessage, parseArgv } from './options'
import { updateActivity, showSuggestions } from './utils'
import { simplify } from 'koishi-utils'
import { EventEmitter } from 'events'
import { PoolConfig } from 'mysql'
import { Meta } from './meta'

export interface AppOptions {
  port?: number
  name?: string
  token?: string
  secret?: string
  sendURL?: string
  selfId?: number
  wsServer?: string
  operators?: number[]
  database?: PoolConfig
  shareConnection?: boolean
  imageServerKey?: string,
}

const defaultOptions: AppOptions = {
  port: 8080,
  sendURL: 'http://127.0.0.1:5700',
  shareConnection: true,
}

let database: Database

export class App extends Context {
  app = this
  path = '/'
  server: Server
  options: AppOptions
  database: Database
  receiver: AppReceiver
  atMeRE: RegExp
  prefixRE: RegExp
  userPrefixRE: RegExp
  groups = new Set<number>()
  _commands: Command[] = []
  _commandMap: Record<string, Command> = {}
  _shortcuts: ShortcutConfig[] = []
  _shortcutMap: Record<string, Command> = {}
  _middlewares: [string, Middleware][] = []
  _contexts: Record<string, Context> = {
    '/': this
  }

  constructor (options: AppOptions = {}) {
    super()
    this.options = { ...defaultOptions, ...options }
    if (database && options.shareConnection) {
      this.database = database
    } else if (options.database) {
      database = this.database = new Database(options.database)
    }
    this.server = new Server(this)
    this.sender = new Sender(this.options.sendURL, this.options.token, this.receiver)
    const nameRE = escapeRegex(this.app.options.name)
    this.atMeRE = new RegExp(`^\\[CQ:at,qq=${this.app.options.selfId}\\]`)
    this.prefixRE = new RegExp(`^(\\[CQ:at,qq=${this.app.options.selfId}\\] *|@${nameRE} +|${nameRE}[,，\s] *|\\.)`)
    this.userPrefixRE = new RegExp(`^${nameRE}[,，\s] *`)

    this.receiver.on('*/*/message', meta => this._applyMiddlewares(meta))
    this.middleware((meta, next) => this._preprocess(meta, next))
  }

  group (groupId: number, options: GroupOptions = {}) {
    const path = `/group/${groupId}/`
    if (!this._contexts[path]) {
      this._contexts[path] = new GroupContext(groupId, options, this)
    }
    return this._contexts[path] as GroupContext
  }

  allGroups (options: GroupOptions = {}) {
    if (!this._contexts['/group/*/']) {
      this._contexts['/group/*/'] = new MultiGroupContext(options, this)
    }
    return this._contexts['/group/*/'] as MultiGroupContext
  }

  user (userId: number, options: UserOptions = {}) {
    const path = `/private/${userId}/`
    if (!this._contexts[path]) {
      this._contexts[path] = new UserContext(userId, options, this)
    }
    return this._contexts[path] as UserContext
  }

  allUsers (options: UserOptions = {}) {
    if (!this._contexts['/user/*/']) {
      this._contexts['/user/*/'] = new MultiUserContext(options, this)
    }
    return this._contexts['/user/*/'] as MultiUserContext
  }

  start () {
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
      fields.push(...parsedArgv.command._fields)
    } else if (canBeShortcut) {
      // parse as shortcut
      for (const shortcut of this._shortcuts) {
        const { name, fuzzy, command, oneArg } = shortcut
        if (shortcut.prefix && !canBeCommand) continue
        if (!fuzzy && message !== name) continue
        if (message.startsWith(name)) {
          const _message = message.slice(name.length)
          if (fuzzy && !shortcut.prefix && _message.match(/^\S/)) continue
          const argv = oneArg ? [_message.trim()] : splitMessage(_message)
          const { args, options: parsedOptions, rawOptions } = parseArgv(argv, command)
          const options = { ...parsedOptions, ...shortcut.options }
          fields.push(...command._fields)
          parsedArgv = { name, meta, message, rawOptions, options, args, command }
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

  _parseCommandLine (message: string, meta: Meta): ParsedArgv {
    const name = message.split(/\s/, 1)[0].toLowerCase()
    const command = this._commandMap[name]
    if (command && isAncestor(command.context.path, meta.$path)) {
      // parse as command
      showCommandLog('command: %s', name)
      const argv = splitMessage(message.slice(name.length).trimStart())
      const { args, options, rawOptions } = parseArgv(argv, command)
      return { name, meta, message, rawOptions, options, args, command }
    }
  }

  private async _applyMiddlewares (meta: Meta) {
    const middlewares: Middleware[] = this._middlewares
      .filter(([path]) => isAncestor(path, meta.$path))
      .map(([_, middleware]) => middleware)

    // execute middlewares
    let index = -1
    await (async function next (fallback?: NextFunction) {
      ++ index
      if (fallback) middlewares.push((_, next) => fallback(next))
      const middleware = middlewares[index]
      if (middleware) return middleware(meta, next)
    })()

    // flush user data
    if (meta.$user) await meta.$user.update()
  }

  _getEventTypes (path: string) {
    const capture = /^\/(\w+\/)\d+\//.exec(path)
    if (capture) {
      const prefixes = [capture[1] + '*/', capture[0].slice(1)]
      const segments = path.slice(capture[0].length).split('/')
      const types = [].concat(...prefixes.map(prefix => segments.map((_, index) => prefix + segments.slice(0, index + 1).join('/'))))
      if (path.includes('message')) types.push('*/*/message')
      return types
    } else {
      return super._getEventTypes(path)
    }
  }
}

export type AppEvent = 'group/*/message' | 'group/*/message/normal' | 'group/*/message/notice' | 'group/*/message/anonymous'
  | 'group/*/group_upload' | 'group/*/group_admin' | 'group/*/group_admin/unset' | 'group/*/group_admin/set'
  | 'group/*/group_increase' | 'group/*/group_increase/approve' | 'group/*/group_increase/invite'
  | 'group/*/group_decrease' | 'group/*/group_decrease/leave' | 'group/*/group_decrease/kick' | 'group/*/group_decrease/kick_me'
  | 'user/*/message' | 'user/*/message/friend' | 'user/*/message/group' | 'user/*/message/discuss' | 'user/*/message/other'
  | 'discuss/*/message' | 'notice' | 'notice/friend_add' | 'request' | 'request/friend'
  | 'request/group' | 'request/group/add' | 'request/group/invite' | '*/*/message' | 'connected'
  | 'send' | 'send/group' | 'send/user' | 'send/discuss'

export interface AppReceiver extends EventEmitter {
  on (event: AppEvent, listener: (meta: Meta) => any): this
  on (event: string, listener: (meta: Meta) => any): this
  once (event: AppEvent, listener: (meta: Meta) => any): this
  once (event: string, listener: (meta: Meta) => any): this
}
