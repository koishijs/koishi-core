import { isInteger, getDateNumber } from 'koishi-utils'
import { NextFunction, Middleware, Context } from './context'
import { UserData } from './database'
import { Command } from './command'
import { MessageMeta, ContextType } from './meta'
import leven from 'leven'

export type Activity = Record<number, Record<number, number>>

const PRESERVE_ACTIVITY = 7

export function updateActivity (activity: Activity, groupId: number) {
  const date = getDateNumber()
  if (!activity[date]) {
    activity[date] = {}
    const dates = Object.keys(activity)
    dates.slice(0, -PRESERVE_ACTIVITY).forEach(date => delete activity[date])
  }
  if (!activity[date][groupId]) {
    activity[date][groupId] = 1
  } else {
    activity[date][groupId] += 1
  }
}

function getMaxActivity (activity: Record<number, number> = {}) {
  return Math.max(0, ...Object.keys(activity).map(k => activity[k]))
}

export function getAverageActivity (activity: Activity, date: number) {
  return getMaxActivity(activity[date - 1]) / 2
    + getMaxActivity(activity[date - 2]) / 3
    + getMaxActivity(activity[date - 3]) / 6
}

export function getSenderName (meta: MessageMeta) {
  if (meta.$user.name !== String(meta.userId)) return meta.$user.name
  return meta.messageType !== 'private' ? `[CQ:at,qq=${meta.userId}]` : meta.sender.card || meta.sender.nickname
}

export function getUserName (user: Pick<UserData, 'id' | 'name'>) {
  const idString = '' + user.id
  return user.name === idString ? idString : user.name
}

export function getContextId (meta: MessageMeta) {
  if (meta.messageType === 'group') {
    return 'g' + meta.groupId
  } else if (meta.messageType === 'discuss') {
    return 'd' + meta.discussId
  } else {
    return 'p' + meta.userId
  }
}

export function getTargetId (target: string) {
  if (!target) return
  let qq = Number(target)
  if (!qq) {
    const capture = /\[CQ:at,qq=(\d+)\]/.exec(target)
    if (capture) qq = Number(capture[1])
  }
  if (!isInteger(qq)) return
  return qq
}

export function assertContextType (ctx: Context, type: ContextType) {
  // FIXME:
  // if (!ctx.id || !ctx.path.slice(1).startsWith(type)) {
  //   throw new Error(`expect a ${type} context, received path: ${ctx.path}`)
  // }
}

interface SuggestOptions {
  target: string
  items: string[]
  meta: MessageMeta
  next: NextFunction
  prefix: string
  suffix: string
  command: Command | ((suggestion: string) => Command)
  execute: (suggestion: string, meta: MessageMeta, next: NextFunction) => any
}

export const SIMILARITY_COEFFICIENT = 0.4

function findSimilar (target: string) {
  return (name: string) => name.length > 2 && leven(name, target) <= name.length * SIMILARITY_COEFFICIENT
}

export function showSuggestions (options: SuggestOptions) {
  const { target, items, meta, next, prefix, suffix, execute } = options
  const suggestions = items.filter(findSimilar(target))
  if (!suggestions.length) return next()

  return next(async () => {
    let message = `${prefix}你要找的是不是${suggestions.map(name => `“${name}”`).join('或')}？`
    if (suggestions.length === 1) {
      const [suggestion] = suggestions
      const command = typeof options.command === 'function'
        ? options.command(suggestion)
        : options.command
      const userId = meta.userId
      const contextId = getContextId(meta)
      const fields = Array.from(command._userFields)
      if (!fields.includes('name')) fields.push('name')
      if (!fields.includes('usage')) fields.push('usage')
      if (!fields.includes('authority')) fields.push('authority')

      const middleware: Middleware = async (meta, next) => {
        if (getContextId(meta) !== contextId || meta.userId !== userId) return next()
        command.context.removeMiddleware(middleware)
        if (!meta.message.trim()) {
          meta.$user = await command.context.database.observeUser(userId, 0, fields)
          return execute(suggestions[0], meta, next)
        } else {
          return next()
        }
      }
      command.context.premiddleware(middleware)
      message += suffix
    }
    await meta.$send(message)
  })
}
