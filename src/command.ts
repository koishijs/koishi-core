import { CommandOption, CommandArgument, OptionConfig, removeBrackets, parseArguments, parseOption, parseLine } from './parser'
import { Context, isAncestor, NextFunction } from './context'
import { UserData, UserField } from './database'
import { Meta } from './meta'
import debug from 'debug'

export const showCommandLog = debug('app:command')

export interface ParsedArgv {
  meta: Meta
  name?: string
  message?: string
  args?: string[]
  rawOptions?: Record<string, any>
  options?: Record<string, any>
  next?: NextFunction
  command?: Command
}

export type UserType <T> = T | ((user: UserData, meta: Meta) => T)

export interface CommandConfig {
  /** disallow unknown options */
  strict?: boolean
  /** usage identifier */
  usageName?: string
  authority?: number
  authorityHint?: string
  hidden?: UserType<boolean>
  maxUsage?: UserType<number>
  maxUsageText?: string
  minInterval?: UserType<number>
  showWarning?: boolean
}

const defaultConfig: CommandConfig = {
  authority: 1,
  maxUsage: Infinity,
  minInterval: 0,
}

export interface ShortcutConfig {
  name?: string
  command?: Command
  authority?: number
  hidden?: boolean
  prefix?: boolean
  fuzzy?: boolean
  oneArg?: boolean
  options?: Record<string, any>
}

export class Command {
  name: string

  _action?: (this: Command, config: ParsedArgv, ...args: any[]) => any
  _options: CommandOption[]
  _argDef: CommandArgument[]
  _usage?: string
  _examples: string[]
  _children: Command[] = []
  _parent: Command = null
  _shortcuts: Record<string, ShortcutConfig> = {}
  _optionMap: Record<string, CommandOption> = {}
  _config: CommandConfig
  _aliases = new Set<string>()
  _userFields = new Set<UserField>()

  constructor (public rawName: string, public description: string, public context: Context, config: CommandConfig) {
    this._options = []
    this.name = removeBrackets(rawName)
    this._argDef = parseArguments(rawName)
    this._examples = []
    this._config = { ...defaultConfig, ...config }
    context.app._registerCommand(this.name, this)
  }

  get authority () {
    return this._config.authority
  }

  userFields (fields: Iterable<UserField>) {
    for (const field of fields) {
      this._userFields.add(field)
    }
    return this
  }

  alias (...names: string[]) {
    for (const name of names) {
      this.context.app._registerCommand(name, this)
      this._aliases.add(name)
    }
    return this
  }

  config (config: CommandConfig) {
    Object.assign(this._config, config)
    return this
  }

  subcommand (name: string, description = '', config: CommandConfig = {}) {
    if (name.startsWith('.')) name = this.name + name
    const command = this.context.command(name, description, config)
    if (!command._parent) {
      command._parent = this
      this._children.push(command)
    }
    return command
  }

  shortcut (name: string, config: ShortcutConfig = {}) {
    config = this._shortcuts[name] = {
      name,
      command: this,
      authority: this.authority,
      ...config,
    }
    this.context.app._shortcutMap[name] = this
    this.context.app._shortcuts.push(config)
    return this
  }

  usage (text: string) {
    this._usage = text
    return this
  }

  example (example: string) {
    this._examples.push(example)
    return this
  }

  /**
   * Add a option for this command
   * @param rawName raw option name(s)
   * @param description option description
   * @param config option config
   */
  option (rawName: string, description = '', config?: OptionConfig) {
    const option = parseOption(rawName, description, config)
    this._options.push(option)
    for (const name of option.names) {
      // FIXME: no- prefix conflict
      this._optionMap[name] = option
    }
    return this
  }

  action (callback: (this: this, options: ParsedArgv, ...args: any[]) => any) {
    this._action = callback
    return this
  }

  /**
   * Check if a command name is matched by this command
   * @param name Command name
   */
  match (name: string, meta?: Meta) {
    if (this.name !== name && !this._aliases.has(name)) return false
    return !meta || isAncestor(this.context.path, meta.$path) && !this.getConfig('hidden', meta)
  }

  getConfig <K extends keyof CommandConfig> (key: K, meta: Meta): Exclude<CommandConfig[K], (user: UserData, meta: Meta) => any> {
    const value = this._config[key] as any
    return typeof value === 'function' ? value(meta.$user, meta) : value
  }

  updateUsage (user: UserData, time = new Date()) {
    const name = this._config.usageName || this.name
    if (!user.usage[name]) {
      user.usage[name] = {}
    }
    const usage = user.usage[name]
    const date = time.toLocaleDateString()
    if (date !== usage.date) {
      usage.count = 0
      usage.date = date
    }
    return usage
  }

  parseLine (source: string) {
    return parseLine(source, this._argDef, this._optionMap)
  }

  async run (config: ParsedArgv) {
    const { meta } = config
    if (this._children.length && !this._action) {
      return this.context.getCommand('help', meta).run({ meta, args: [this.name] })
    }

    let isUsage = true
    const user = meta.$user
    config = {
      args: [],
      name: this.name,
      rawOptions: {},
      options: {},
      next: () => {},
      ...config,
    }

    // 检查使用权限
    if (this._config.authority > user.authority) {
      return config.meta.$send('权限不足')
    }
    for (const option of this._options) {
      if (option.camels[0] in config.options) {
        if (option.authority > user.authority) return config.meta.$send('权限不足')
        if (option.notUsage) isUsage = false
      }
    }

    // 检查触发次数与间隔
    const minInterval = this.getConfig('minInterval', config.meta)
    if (isUsage || minInterval > 0) {
      const maxUsage = this.getConfig('maxUsage', config.meta)

      if (maxUsage < Infinity || minInterval > 0) {
        const date = new Date()
        const usage = this.updateUsage(user, date)

        if (minInterval > 0) {
          const now = date.valueOf()
          if (now - usage.last <= minInterval) {
            if (this._config.showWarning) {
              await config.meta.$send('调用过于频繁，请稍后再试')
            }
            return
          }
          usage.last = now
        }

        if (usage.count >= maxUsage && isUsage) {
          await config.meta.$send('调用次数已达上限')
          return
        } else {
          usage.count++
        }
      }
    }

    const args = this._argDef.map((arg, index) => arg.variadic ? config.args.slice(index) : config.args[index])
    return this._action(config, ...args)
  }

  end () {
    return this.context
  }
}
