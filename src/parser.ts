import { camelCase } from 'koishi-utils'

const ANGLED_BRACKET_REGEXP = /<([^>]+)>/g
const SQUARE_BRACKET_REGEXP = /\[([^\]]+)\]/g

export function removeBrackets (source: string) {
  return source.replace(/[<[].+/, '').trim()
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

export interface CommandArgument {
  required: boolean
  variadic: boolean
  noSegment: boolean
  name: string
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

export interface OptionConfig {
  default?: any
  hidden?: boolean
  authority?: number
  notUsage?: boolean
  isString?: boolean
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

interface ParsedArg0 {
  rest: string
  content: string
  quoted: boolean
}

function parseArg0 (source: string): ParsedArg0 {
  const char0 = source[0]
  if (char0 === '"' || char0 === "'" || char0 === '“' || char0 === '”') {
    const [content] = source.slice(1).split(/["'“”](?=\s|$)/, 1)
    return {
      quoted: true,
      content,
      rest: source.slice(2 + content.length).trimLeft(),
    }
  }

  const [content] = source.split(/\s/, 1)
  return { content, quoted: false, rest: source.slice(content.length).trimLeft() }
}

export function parseValue (source: string | true, config: CommandOption, quoted: boolean) {
  // quoted empty string
  if (source === '' && quoted) return ''
  // no explicit parameter
  if (source === true || source === '') {
    if (config && config.default !== undefined) return config.default
    if (config && config.isString) return ''
    return true
  }
  // default behavior
  if (config && config.isString) return source
  const n = +source
  return n * 0 === 0 ? n : source
}

export interface ParsedResult {
  source: string
  rest: string
  args: string[]
  unknown: string[]
  options: Record<string, any>
}

export function parseLine (source: string, argsConfig: CommandArgument[], optsConfig: Record<string, CommandOption>) {
  let arg: string, name: string, arg0: ParsedArg0
  const args: string[] = []
  const unknown: string[] = []
  const options: Record<string, any> = {}
  const result: ParsedResult = { source, args, unknown, options, rest: '' }

  while (source) {
    if (source[0] !== '-' && argsConfig[args.length] && argsConfig[args.length].noSegment) {
      args.push(source)
      break
    }
    arg0 = parseArg0(source)
    arg = arg0.content
    source = arg0.rest
    if (arg[0] !== '-' || arg0.quoted) {
      args.push(arg)
      continue
    } else if (arg === '--') {
      result.rest = arg0.rest
      break
    }

    // find -
    let i = 0
    for (; i < arg.length; ++i) {
      if (arg.charCodeAt(i) !== 45) break
    }
    if (arg.slice(i, i + 3) === 'no-') {
      name = arg.slice(i + 3)
      if (!optsConfig[name] && !unknown.includes(name)) {
        unknown.push(name)
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

    // get parameter
    let quoted = false
    let param: any = arg.slice(++j)
    const lastConfig = optsConfig[names[names.length - 1]]
    if (!param && source.charCodeAt(0) !== 45 && (!lastConfig || !lastConfig.isBoolean)) {
      arg0 = parseArg0(source)
      param = arg0.content
      quoted = arg0.quoted
      source = arg0.rest
    }

    // handle names
    for (j = 0; j < names.length; j++) {
      name = names[j]
      const config = optsConfig[name]
      if (!config && !unknown.includes(name)) {
        unknown.push(name)
      }
      const value = parseValue((j + 1 < names.length) || param, config, quoted)
      if (config) {
        for (const alias of config.camelNames) {
          options[alias] = value
        }
      } else {
        options[camelCase(name)] = value
      }
    }
  }

  const diff = argsConfig.length - args.length
  if (diff > 0) args.push(...new Array(diff).fill(''))

  return result
}
