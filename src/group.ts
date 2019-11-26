import { App } from './app'
import Context from './context'
import { EventEmitter } from 'events'
import { Meta } from './meta'

export interface GroupOptions {
  authority?: number
}

const defaultGroupOptions: GroupOptions = {
  authority: 1,
}

export default class GroupContext extends Context {
  public receiver: GroupReceiver
  public options: GroupOptions

  constructor (public id: number, options: GroupOptions, public app: App) {
    super()
    this.path = `/group/${id}/`
    this.sender = app.sender
    this.database = app.database
    this.options = { ...defaultGroupOptions, ...options }
    this.plugin(authorize, this.options)
    if (id as any !== '*') {
      app.groups.add(id)
    }
  }
}

interface GroupMember {
  userId?: number
}

function authorize (ctx: GroupContext, { authority }: GroupOptions) {
  // FIXME: no *
  if (ctx.id as any === '*') return

  ctx.receiver.once('connected', async () => {
    await ctx.database.getGroup(ctx.id, ctx.app.options.selfId)
    const memberIds = (await ctx.sender.getGroupMemberList(ctx.id)).map(m => m.userId)
    const users = await ctx.app.database.getUsers(memberIds)
    const userIds = users.map(u => u.id)
    const insertIds = memberIds.filter((id) => !userIds.includes(id))
    const updateIds = memberIds.filter((id) => {
      const user = users.find(u => u.id === id)
      return user && user.authority < authority
    })

    // TODO: set multiple
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

export type GroupEvent = 'message' | 'message/normal' | 'message/notice' | 'message/anonymous'
  | 'group_upload' | 'group_admin' | 'group_admin/unset' | 'group_admin/set'
  | 'group_increase' | 'group_increase/approve' | 'group_increase/invite'
  | 'group_decrease' | 'group_decrease/leave' | 'group_decrease/kick' | 'group_decrease/kick_me'
  | 'connected'

export interface GroupReceiver extends EventEmitter {
  on (event: GroupEvent, listener: (meta: Meta) => any): this
  once (event: GroupEvent, listener: (meta: Meta) => any): this
}

export class MultiGroupContext extends GroupContext {
  constructor (options: GroupOptions, public app: App) {
    super('*' as any, options, app)
  }
}
