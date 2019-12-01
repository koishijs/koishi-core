import { isInteger, getDateNumber } from 'koishi-utils'
import { NextFunction, Middleware } from './context'
import { UserData } from './database'
import { Command } from './command'
import { Meta } from './meta'
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

export function getSenderName (meta: Meta) {
  if (meta.$user.name !== String(meta.userId)) return meta.$user.name
  return meta.messageType !== 'private' ? `[CQ:at,qq=${meta.userId}]` : meta.sender.card || meta.sender.nickname
}

export function getUserName (user: UserData) {
  return user.name === String(user.id) ? String(user.id) : user.name
}

export function getContextId (meta: Meta) {
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

interface SuggestOptions {
  target: string
  items: string[]
  meta: Meta
  next: NextFunction
  prefix: string
  postfix: string
  command: Command | ((suggestion: string) => Command)
  execute: (suggestion: string, meta: Meta, next: NextFunction) => any
}

export const SIMILARITY_COEFFICIENT = 0.4

function findSimilar (target: string) {
  return (name: string) => name.length > 2 && leven(name, target) <= name.length * SIMILARITY_COEFFICIENT
}

export function showSuggestions (options: SuggestOptions) {
  const { target, items, meta, next, prefix, postfix, execute } = options
  const suggestions = items.filter(findSimilar(target))
  if (!suggestions.length) return next()

  return next(() => {
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
      command.context.middleware(middleware, 0)
      message += postfix
    }
    return meta.$send(message)
  })
}
