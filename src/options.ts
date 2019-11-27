import mri, { Options as MriOptions } from 'mri'
import { camelCase } from 'koishi-utils'
import Command from './command'

export interface OptionConfig {
  default?: any
  type?: any
  hidden?: boolean
  authority?: number
  notUsage?: boolean
  noNagated?: boolean
}

export interface CommandOption {
  rawName: string
  name: string
  names: string[]
  negated: boolean
  required: boolean
  isBoolean: boolean
  config: OptionConfig
  description: string
}

export function parseOption (rawName: string, description: string, config: OptionConfig = {}): CommandOption {
  config = { authority: 0, ...config }

  let negated = false, required = false, isBoolean = false
  const names = removeBrackets(rawName).split(',').map((name: string) => {
    name = name.trim().replace(/^-{1,2}/, '')
    if (name.startsWith('no-') && !config.noNagated) {
      negated = true
      name = name.replace(/^no-/, '')
    }
    return name
  }).sort((a, b) => a.length > b.length ? 1 : -1)

  const name = names[names.length - 1]

  if (negated) {
    config.default = true
  }

  if (rawName.includes('<')) {
    required = true
  } else if (!rawName.includes('[')) {
    isBoolean = true
  }

  return {
    rawName,
    config,
    names,
    name,
    negated,
    required,
    isBoolean,
    description,
  }
}

export function getMriOptions (options: CommandOption[]) {
  const result: MriOptions = { alias: {}, boolean: [] }

  options.forEach((option) => {
    if (option.names.length > 1) {
      result.alias[option.name] = option.names.slice(0, -1)
    }

    if (option.isBoolean) {
      (result.boolean as string[]).push(option.name)
    }
  })

  return result
}

export function parseArgv (argv: string[], command: Command) {
  const mriOptions = getMriOptions(command.options)

  let argsAfterDoubleDashes: string[] = []
  const doubleDashesIndex = argv.indexOf('--')
  if (doubleDashesIndex > -1) {
    argsAfterDoubleDashes = argv.slice(doubleDashesIndex + 1)
    argv = argv.slice(0, doubleDashesIndex)
  }

  const rawOptions = mri(argv, mriOptions)

  const args = rawOptions._.map(arg => typeof arg === 'string' ? arg.replace('@@__HYPHEN_PLACEHOLDER__@@', '-') : arg)
  delete rawOptions._

  const options: Record<string, any> = {
    '--': argsAfterDoubleDashes,
  }

  const typeMap = {}

  for (const option of command.options) {
    for (const name of option.names) {
      typeMap[name] = option.config.type
      if (option.config.default !== undefined) {
        options[name] = option.config.default
      }
    }
  }

  for (const key in rawOptions) {
    options[camelCase(key)] = inferType(rawOptions[key], typeMap[key])
  }

  return {
    args,
    options,
    rawOptions,
  }
}

export function inferType (value: any, type: any) {
  if (type === String || type === Number) {
    return typeof value === 'boolean' ? type() : type(value)
  } else if (type === Boolean) {
    return type(value)
  } else {
    return value
  }
}

export function splitMessage (input: string) {
  return (input.match(/("([^"]|"\S)*"|“([^”]|”\S)*”|\S+)(?=\s|$)/g) || [])
    .map(str => str
      .replace(/^"([\s\S]*)"$/, str => str.slice(1, -1).replace(/^-/, '@@__HYPHEN_PLACEHOLDER__@@'))
      .replace(/^“([\s\S]*)”$/, str => str.slice(1, -1).replace(/^-/, '@@__HYPHEN_PLACEHOLDER__@@')))
}

export const removeBrackets = (v: string) => v.replace(/[<[].+/, '').trim()

export const findAllBrackets = (v: string) => {
  const ANGLED_BRACKET_RE_GLOBAL = /<([^>]+)>/g
  const SQUARE_BRACKET_RE_GLOBAL = /\[([^\]]+)\]/g

  const res = []

  const parse = (match: string[]) => {
    let variadic = false
    let value = match[1]
    if (value.startsWith('...')) {
      value = value.slice(3)
      variadic = true
    }
    return {
      required: match[0].startsWith('<'),
      value,
      variadic,
    }
  }

  let angledMatch
  while ((angledMatch = ANGLED_BRACKET_RE_GLOBAL.exec(v))) {
    res.push(parse(angledMatch))
  }

  let squareMatch
  while ((squareMatch = SQUARE_BRACKET_RE_GLOBAL.exec(v))) {
    res.push(parse(squareMatch))
  }

  return res
}
