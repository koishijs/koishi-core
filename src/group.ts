import { App } from './app'
import { Context } from './context'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface GroupOptions {
  authority?: number
}

const defaultGroupOptions: GroupOptions = {
  authority: 1,
}

export class GroupContext extends Context {
  public receiver: GroupReceiver
  public options: GroupOptions

  constructor (public id: number, options: GroupOptions, app: App) {
    super(`/group/${id}/`, app)
    this.options = { ...defaultGroupOptions, ...options }
    if (app.database) this.plugin(authorize, this.options)
  }
}

interface GroupMember {
  userId?: number
}

function authorize (ctx: GroupContext, { authority }: GroupOptions) {
  ctx.app.receiver.once('connected', async () => {
    await ctx.database.getGroup(ctx.id, ctx.app.options.selfId)
    const memberIds = (await ctx.sender.getGroupMemberList(ctx.id)).map(m => m.userId)
    const users = await ctx.app.database.getUsers(memberIds)
    const userIds = users.map(u => u.id)
    const insertIds = memberIds.filter((id) => !userIds.includes(id))
    const updateIds = memberIds.filter((id) => {
      const user = users.find(u => u.id === id)
      return user && user.authority < authority
    })

    for (const id of insertIds) {
      await ctx.database.getUser(id, authority)
    }

    for (const id of updateIds) {
      await ctx.database.setUser(id, { authority })
    }
  })

  ctx.receiver.on('group_increase', updateAuthority)

  async function updateAuthority ({ userId }: GroupMember) {
    const user = await ctx.database.getUser(userId, authority)
    if (user.authority < authority) {
      return ctx.database.setUser(userId, { authority })
    }
  }
}

export type GroupMessageEvent = 'message' | 'message/normal' | 'message/notice' | 'message/anonymous'
export type GroupNoticeEvent = 'group_increase' | 'group_increase/approve' | 'group_increase/invite'
  | 'group_decrease' | 'group_decrease/leave' | 'group_decrease/kick' | 'group_decrease/kick_me'
  | 'group_upload' | 'group_admin' | 'group_admin/unset' | 'group_admin/set' | 'group_ban'
export type GroupRequestEvent = 'request' | 'request/add' | 'request/invite'

export interface GroupReceiver extends EventEmitter {
  on (event: GroupNoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  on (event: GroupMessageEvent, listener: (meta: Meta<'message'>) => any): this
  on (event: GroupRequestEvent, listener: (meta: Meta<'request'>) => any): this
  once (event: GroupNoticeEvent, listener: (meta: Meta<'notice'>) => any): this
  once (event: GroupMessageEvent, listener: (meta: Meta<'message'>) => any): this
  once (event: GroupRequestEvent, listener: (meta: Meta<'request'>) => any): this
}
