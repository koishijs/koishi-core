import { Context, NextFunction } from './context'
import { UserData, UserField } from './database'
import { noop } from 'koishi-utils'
import { MessageMeta } from './meta'
import { format } from 'util'
import * as messages from './messages'
import * as errors from './errors'
import debug from 'debug'

import {
  CommandOption,
  CommandArgument,
  OptionConfig,
  removeBrackets,
  parseArguments,
  parseOption,
  parseLine,
  ParsedLine,
} from './parser'

const showCommandLog = debug('app:command')

export interface ParsedCommandLine extends ParsedLine {
  meta: MessageMeta
  command: Command
  next?: NextFunction
}

export type UserType <T> = T | ((user: UserData, meta: MessageMeta) => T)

export interface CommandConfig {
  /** disallow unknown options */
  checkUnknown?: boolean
  /** check required options */
  checkRequired?: boolean
  /** check argument count */
  checkArgCount?: boolean
  /** usage identifier */
  usageName?: string
  /** description */
  description?: string
  /** min authority */
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
  config: CommandConfig
  children: Command[] = []
  parent: Command = null

  _aliases: string[] = []
  _action?: (this: Command, config: ParsedCommandLine, ...args: string[]) => any
  _options: CommandOption[] = []
  _argsDef: CommandArgument[]
  _usage?: string
  _examples: string[] = []
  _shortcuts: Record<string, ShortcutConfig> = {}
  _optsDef: Record<string, CommandOption> = {}
  _userFields = new Set<UserField>()

  constructor (public rawName: string, public context: Context, config: CommandConfig = {}) {
    this.name = removeBrackets(rawName)
    if (!this.name) {
      throw new Error(errors.EXPECT_COMMAND_NAME)
    } else if (!/^[\w.-]+$/.exec(this.name)) {
      throw new Error(errors.INVALID_CHARACTER)
    }
    this._argsDef = parseArguments(rawName)
    this.config = { ...defaultConfig, ...config }
    this._registerAlias(this.name)
    this.option('-h, --help', messages.SHOW_THIS_MESSAGE)
    context.app._commands.push(this)
  }

  private _registerAlias (name: string) {
    name = name.toLowerCase()
    this._aliases.push(name)
    const previous = this.context.app._commandMap[name]
    if (!previous) {
      this.context.app._commandMap[name] = this
    } else if (previous !== this) {
      throw new Error(errors.DUPLICATE_COMMAND)
    }
  }

  userFields (fields: Iterable<UserField>) {
    for (const field of fields) {
      this._userFields.add(field)
    }
    return this
  }

  alias (...names: string[]) {
    for (const name of names) {
      this._registerAlias(name)
    }
    return this
  }

  subcommand (name: string, description = '', config: CommandConfig = {}) {
    const dotPrefixed = name.startsWith('.')
    if (dotPrefixed) name = this.name + name
    const [firstName] = name.split(/(?=[\s/])/, 1)
    if (this.context.app._commandMap[firstName.toLowerCase()]) {
      throw new Error(errors.EXISTING_SUBCOMMAND)
    }
    if (!dotPrefixed) name = this.name + '/' + name
    const command = this.context.command(name, description, config)
    return command
  }

  shortcut (name: string, config: ShortcutConfig = {}) {
    config = this._shortcuts[name] = {
      name,
      command: this,
      authority: this.config.authority,
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
    const option = parseOption(rawName, description, config, this._optsDef)
    this._options.push(option)
    for (const name of option.names) {
      if (name in this._optsDef) {
        throw new Error(errors.DUPLICATE_OPTION)
      }
      this._optsDef[name] = option
    }
    return this
  }

  action (callback: (this: this, options: ParsedCommandLine, ...args: string[]) => any) {
    this._action = callback
    return this
  }

  getConfig <K extends keyof CommandConfig> (key: K, meta: MessageMeta): Exclude<CommandConfig[K], (user: UserData, meta: MessageMeta) => any> {
    const value = this.config[key] as any
    return typeof value === 'function' ? value(meta.$user, meta) : value
  }

  updateUsage (user: UserData, time = new Date()) {
    const name = this.config.usageName || this.name
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

  parse (source: string) {
    return parseLine(source, this._argsDef, this._optsDef)
  }

  async execute (config: ParsedCommandLine, next: NextFunction = noop) {
    const { meta, options, args, unknown } = config
    config.next = next

    // show help when use `-h, --help` or when there is no action
    if (!this._action || options.help) {
      return this.context.runCommand('help', meta, [this.name])
    }

    // check argument count
    if (this.config.checkArgCount) {
      const nextArg = this._argsDef[args.length]
      if (nextArg && nextArg.required) {
        return meta.$send(messages.INSUFFICIENT_ARGUMENTS)
      }
      const finalArg = this._argsDef[this._argsDef.length - 1]
      if (args.length > this._argsDef.length && !finalArg.noSegment && !finalArg.variadic) {
        return meta.$send(messages.REDUNANT_ARGUMENTS)
      }
    }

    // check unknown options
    if (this.config.checkUnknown && unknown.length) {
      return meta.$send(format(messages.UNKNOWN_OPTIONS, unknown.join(', ')))
    }

    // check required options
    if (this.config.checkRequired) {
      const absent = this._options.filter((option) => {
        return option.required && !(option.camels[0] in options)
      })
      if (absent.length) {
        return meta.$send(format(messages.REQUIRED_OPTIONS, absent.join(', ')))
      }
    }

    if (this._checkUser(meta, options)) {
      showCommandLog('execute %s', this.name)
      return this._action(config, ...args)
    }
  }

  /** check authority and usage */
  private async _checkUser (meta: MessageMeta, options: Record<string, any>) {
    const user = meta.$user
    if (!user) return true
    let isUsage = true

    // check authority
    if (this.config.authority > user.authority) {
      return meta.$send(messages.LOW_AUTHORITY)
    }
    for (const option of this._options) {
      if (option.camels[0] in options) {
        if (option.authority > user.authority) return meta.$send(messages.LOW_AUTHORITY)
        if (option.notUsage) isUsage = false
      }
    }

    // check usage
    const minInterval = this.getConfig('minInterval', meta)
    if (isUsage || minInterval > 0) {
      const maxUsage = this.getConfig('maxUsage', meta)

      if (maxUsage < Infinity || minInterval > 0) {
        const date = new Date()
        const usage = this.updateUsage(user, date)

        if (minInterval > 0) {
          const now = date.valueOf()
          if (now - usage.last <= minInterval) {
            if (this.config.showWarning) {
              await meta.$send(messages.TOO_FREQUENT)
            }
            return
          }
          usage.last = now
        }

        if (usage.count >= maxUsage && isUsage) {
          await meta.$send(messages.USAGE_EXHAUSTED)
          return
        } else {
          usage.count++
        }
      }
    }

    return true
  }

  end () {
    return this.context
  }
}
