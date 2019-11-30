import debug from 'debug'
import axios from 'axios'
import { snakeCase, camelCase } from 'koishi-utils'
import { GroupMemberInfo, Status, VersionInfo, Meta, FriendInfo, GroupInfo, Credentials } from './meta'
import { EventEmitter } from 'events'
import { inspect } from 'util'

const showSenderLog = debug('app:sender')

export class SenderError extends Error {
  readonly name = 'SenderError'

  constructor (readonly args: { [x: string]: any }, readonly url: string, readonly retcode: number) {
    super(`Error when trying to send to ${url}, retcode: ${retcode}, args: ${JSON.stringify(args)}`)
    this.stack = [
      `${this.name}: Error when trying to send to ${this.url}`,
      `Args: ${inspect(this.args, { colors: true })}`,
      `Code: ${this.retcode}`,
    ].join('\n')
  }
}

export type RecordFormat = 'mp3' | 'amr' | 'wma' | 'm4a' | 'spx' | 'ogg' | 'wav' | 'flac'

export class Sender {
  messages = new Array(61).fill(0)
  timer: NodeJS.Timeout
  headers: Record<string, any>

  constructor (protected sendURL: string, token: string, protected receiver: EventEmitter) {
    this.headers = {
      Authorization: `Token ${token}`,
    }
  }

  start () {
    this.timer = setInterval(() => {
      this.messages.unshift(0)
      this.messages.splice(-1, 1)
    }, 1000)
  }

  close () {
    clearInterval(this.timer)
  }

  protected async _post (api: string, args: Record<string, any> = {}) {
    const uri = new URL(api, this.sendURL).href
    showSenderLog('request %s %o', api, args)
    try {
      const { data } = await axios.get(uri, {
        params: snakeCase(args),
        headers: this.headers,
      })
      showSenderLog('response %o', data)
      if (data.retcode === 0) {
        return camelCase(data.data)
      } else {
        throw new SenderError(args, uri, data.retcode)
      }
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  async sendContextMsg (contextId: string, message: string, autoEscape?: boolean): Promise<void> {
    const type = contextId[0]
    const id = parseInt(contextId.slice(1))
    switch (type) {
      case 'g': return this.sendGroupMsg(id, message, autoEscape)
      case 'p': return this.sendPrivateMsg(id, message, autoEscape)
      case 'd': return this.sendDiscussMsg(id, message, autoEscape)
    }
  }

  async sendGroupMsg (groupId: number, message: string, autoEscape?: boolean) {
    if (!groupId || !message) return
    const segments = message.split(/\n/g)
    for (let index = 0; index < segments.length; index += 100) {
      this.messages[0] += 1
      const message = segments.slice(index, index + 100).join('\n')
      await this._post('send_group_msg', { groupId, message, autoEscape })
    }
    const meta = {
      postType: 'message',
      messageType: 'group',
      message,
      groupId,
    } as Meta
    this.receiver.emit('send', meta)
    this.receiver.emit('send/group', meta)
  }

  async sendDiscussMsg (discussId: number, message: string, autoEscape?: boolean) {
    if (!discussId || !message) return
    this.messages[0] += 1
    const response = await this._post('send_discuss_msg', { discussId, message, autoEscape })
    const meta = {
      postType: 'message',
      messageType: 'discuss',
      message,
      discussId,
    } as Meta
    this.receiver.emit('send', meta)
    this.receiver.emit('send/discuss', meta)
    return response
  }

  async sendPrivateMsg (userId: number, message: string, autoEscape?: boolean) {
    if (!userId || !message) return
    this.messages[0] += 1
    const response = await this._post('send_private_msg', { userId, message, autoEscape })
    const meta = {
      postType: 'message',
      messageType: 'private',
      message,
      userId,
    } as Meta
    this.receiver.emit('send', meta)
    this.receiver.emit('send/user', meta)
    return response
  }

  deleteMsg (messageId: number) {
    return this._post('delete_msg', { messageId })
  }

  sendLike (userId: number, times = 1) {
    return this._post('send_like', { userId, times })
  }

  setGroupKick (groupId: number, userId: number, rejectAddRequest = false) {
    return this._post('set_group_kick', { groupId, userId, rejectAddRequest })
  }

  setGroupBan (groupId: number, userId: number, duration = 36 * 60) {
    return this._post('set_group_ban', { groupId, userId, duration })
  }

  setGroupAnonymousBan (groupId: number, anonymous: object, duration: number): Promise<void>
  setGroupAnonymousBan (groupId: number, flag: string, duration: number): Promise<void>
  setGroupAnonymousBan (groupId: number, meta: object | string, duration = 36 * 60) {
    const args = { groupId, duration } as any
    args[typeof meta === 'string' ? 'flag' : 'anomymous'] = meta
    return this._post('set_group_anonymous_ban', args)
  }

  setGroupWholeBan (groupId: number, enable: boolean) {
    return this._post('set_group_whole_ban', { groupId, enable })
  }

  setGroupAdmin (groupId: number, userId: number, enable: boolean) {
    return this._post('set_group_admin', { groupId, userId, enable })
  }

  setGroupAnonymous (groupId: number, enable: boolean) {
    return this._post('set_group_anonymous', { groupId, enable })
  }

  setGroupCard (groupId: number, userId: number, card = '') {
    return this._post('set_group_admin', { groupId, userId, card })
  }

  setGroupLeave (groupId: number, isDismiss = false) {
    return this._post('set_group_leave', { groupId, isDismiss })
  }

  setGroupSpecialTitle (groupId: number, userId: number, specialTitle = '', duration = -1) {
    return this._post('set_group_special_title', { groupId, userId, specialTitle, duration })
  }

  setDiscussLeave (discussId: number) {
    return this._post('set_discuss_leave', { discussId })
  }

  setFriendAddRequest (flag: string, approve = true, remark = '') {
    return this._post('set_friend_add_request', { flag, approve, remark })
  }

  setGroupAddRequest (flag: string, subType: 'add' | 'invite', approve = true, reason = '') {
    return this._post('set_group_add_request', { flag, subType, approve, reason })
  }

  getLoginInfo () {
    return this._post('get_login_info')
  }

  getStrangerInfo (userId: number, noCache = false) {
    return this._post('get_stranger_info', { userId, noCache })
  }

  getFriendList (): Promise<FriendInfo[]> {
    return this._post('get_friend_list')
  }

  getGroupList (): Promise<GroupInfo[]> {
    return this._post('get_group_list')
  }

  getGroupInfo (groupId: string, noCache: boolean): Promise<GroupInfo> {
    return this._post('get_group_info', { groupId, noCache })
  }

  getGroupMemberInfo (groupId: number, userId: number, noCache = false): Promise<GroupMemberInfo> {
    return this._post('get_group_member_info', { groupId, userId, noCache })
  }

  getGroupMemberList (groupId: number): Promise<GroupMemberInfo[]> {
    return this._post('get_group_member_list', { groupId })
  }

  async getCookies (domain?: string): Promise<string> {
    const { cookies } = await this._post('get_cookies', { domain })
    return cookies
  }

  async getCsrfToken (): Promise<number> {
    const { token } = await this._post('get_csrf_token')
    return token
  }

  getCredentials (): Promise<Credentials> {
    return this._post('get_credentials')
  }

  getRecord (file: string, outFormat: RecordFormat, fullPath = false) {
    return this._post('get_record', { file, outFormat, fullPath })
  }

  getImage (file: string) {
    return this._post('get_image', { file })
  }

  canSendImage () {
    return this._post('can_send_image')
  }

  canSendRecord () {
    return this._post('can_send_record')
  }

  getStatus (): Promise<Status> {
    return this._post('get_status')
  }

  getVersionInfo (): Promise<VersionInfo> {
    return this._post('get_version_info')
  }

  setRestartPlugin (delay = 0) {
    return this._post('set_restart_plugin', { delay })
  }

  cleanDataDir (dataDir: string) {
    return this._post('clean_data_dir', { dataDir })
  }

  cleanPluginLog () {
    return this._post('clean_plugin_log')
  }
}
