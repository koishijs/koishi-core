import { UserData, UserField } from './database'
import { Meta } from './meta'
import debug from 'debug'
import Context, { isAncestor, NextFunction } from './context'
import { camelCase } from 'koishi-utils'

export interface OptionConfig {
  default?: any
  type?: any
  hidden?: boolean
  authority?: number
  notUsage?: boolean
}

export interface CommandOption extends OptionConfig {
  rawName: string
  names: string[]
  camelNames: string[]
  negated: boolean
  required: boolean
  isBoolean: boolean
  description: string
}

export function removeBrackets (source: string) {
  return source.replace(/[<[].+/, '').trim()
}

export function parseOption (rawName: string, description: string, config: OptionConfig = {}): CommandOption {
  config = { authority: 0, ...config }

  const camelNames: string[] = []
  let negated = false, required = false, isBoolean = false
  const names = removeBrackets(rawName).split(',').map((name: string) => {
    name = name.trim().replace(/^-{1,2}/, '')
    if (name.startsWith('no-')) {
      negated = true
      name = name.slice(3)
    }
    camelNames.push(camelCase(name))
    return name
  })

  if (negated) config.default = true

  if (rawName.includes('<')) {
    required = true
  } else if (!rawName.includes('[')) {
    isBoolean = true
  }

  return {
    ...config,
    rawName,
    names,
    camelNames,
    negated,
    required,
    isBoolean,
    description,
  }
}

export const showCommandLog = debug('app:command')

const ANGLED_BRACKET_REGEXP = /<([^>]+)>/g
const SQUARE_BRACKET_REGEXP = /\[([^\]]+)\]/g

interface CommandArgument {
  required: boolean
  variadic: boolean
  noSegment: boolean
  name: string
}

function parseBracket (name: string, required: boolean): CommandArgument {
  let variadic = false, noSegment = false
  if (name.startsWith('...')) {
    name = name.slice(3)
    variadic = true
  } else if (name.endsWith('...')) {
    name = name.slice(0, -3)
    noSegment = true
  }
  return {
    name,
    required,
    variadic,
    noSegment,
  }
}

export function parseArguments (source: string) {
  let capture: RegExpExecArray
  const result: CommandArgument[] = []
  while ((capture = ANGLED_BRACKET_REGEXP.exec(source))) {
    result.push(parseBracket(capture[1], true))
  }
  while ((capture = SQUARE_BRACKET_REGEXP.exec(source))) {
    result.push(parseBracket(capture[1], false))
  }
  return result
}

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

export default class Command {
  _action?: (this: Command, config: ParsedArgv, ...args: any[]) => any
  options: CommandOption[]
  name: string
  args: CommandArgument[]
  _usage?: string
  versionNumber?: string
  _examples: string[]
  children: Command[] = []
  parent: Command = null
  _shortcuts: Record<string, ShortcutConfig> = {}
  _optionMap: Record<string, CommandOption> = {}
  _config: CommandConfig
  _aliases = new Set<string>()
  _userFields = new Set<UserField>()

  constructor (public rawName: string, public description: string, public context: Context, config: CommandConfig) {
    this.options = []
    this.name = removeBrackets(rawName)
    this.args = parseArguments(rawName)
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
    if (!command.parent) {
      command.parent = this
      this.children.push(command)
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
  option (rawName: string, description: string, config?: OptionConfig) {
    const option = parseOption(rawName, description, config)
    this.options.push(option)
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
    let arg: string, rest: string, name: string
    const args: string[] = []
    const unknown = new Set<string>()
    const options: Record<string, any> = {}
    while ([arg, source = ''] = source.split(/\s+/, 1), arg) {
      // TODO: handle quotes
      if (arg[0] !== '-') {
        args.push(arg)
        continue
      } else if (arg === '--') {
        rest = arg
        break
      }

      // find -
      let i = 0
      for (; i < arg.length; ++i) {
        if (arg.charCodeAt(i) !== 45) break
      }
      if (arg.slice(i, i + 3) === 'no-') {
        name = arg.slice(i + 3)
        if (this._config.strict && !this._optionMap[name]) {
          unknown.add(name)
        }
        options[name] = false
        continue
      }

      // find =
      let j = i + 1
      for (; j < arg.length; j++) {
        if (arg.charCodeAt(j) === 61) break
      }
      name = arg.slice(i, j)
      const names = i === 2 ? [name] : name

      // get value
      let value: any = arg.slice(++j)
      if (!value && source && source.charCodeAt(0) !== 45) {
        [value, source = ''] = source.split(/\s+/, 1)
      }
      for (j = 0; j < names.length; j++) {
        name = names[j]
        if (this._config.strict && !this._optionMap[name]) {
          unknown.add(name)
        }
        value = (j + 1 < names.length) || value
        // TODO: handle unknown
        // TODO: handle default
        if (this._optionMap[name].type === String) {
          if (!value || value === true) value = ''
        } else {
          const nValue = +value
          if (nValue * 0 === 0) value = nValue
        }
        for (const alias of this._optionMap[name].camelNames) {
          options[alias] = value
        }
      }
    }

    return { args, rest, options, unknown }
  }

  async run (config: ParsedArgv) {
    const { meta } = config
    if (this.children.length && !this._action) {
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
    for (const option of this.options) {
      if (option.camelNames[0] in config.options) {
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

    const args = this.args.map((arg, index) => arg.variadic ? config.args.slice(index) : config.args[index])
    return this._action(config, ...args)
  }

  end () {
    return this.context
  }
}
