import debug from 'debug'
import axios from 'axios'
import { snakeCase, camelCase } from 'koishi-utils'
import { GroupMemberInfo, StatusInfo, VersionInfo, Meta, FriendInfo, GroupInfo, Credentials, AccountInfo, StrangerInfo, ListedGroupInfo } from './meta'
import { App } from './app'

const showSenderLog = debug('app:sender')

export class SenderError extends Error {
  readonly name = 'SenderError'

  constructor (readonly args: Record<string, any>, readonly url: string, readonly retcode: number) {
    super(`Error when trying to send to ${url}, args: ${JSON.stringify(args)}, retcode: ${retcode}`)
  }
}

export type RecordFormat = 'mp3' | 'amr' | 'wma' | 'm4a' | 'spx' | 'ogg' | 'wav' | 'flac'
export type DataDirectoryType = 'image' | 'record' | 'show' | 'bface'

export class Sender {
  messages = new Array(61).fill(0)
  timer: NodeJS.Timeout
  headers: Record<string, any>

  constructor (public app: App) {
    this.headers = {
      Authorization: `Token ${app.options.token}`,
    }
  }

  start () {
    this.timer = setInterval(() => {
      this.messages.unshift(0)
      this.messages.splice(-1, 1)
    }, 1000)
  }

  stop () {
    clearInterval(this.timer)
  }

  protected async _post (api: string, args: Record<string, any> = {}) {
    const uri = new URL(api, this.app.options.sendUrl).href
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

  async sendContextMsg (contextId: string, message: string, autoEscape?: boolean) {
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
    const response = await this._post('send_group_msg', { groupId, message, autoEscape })
    const meta: Meta<'send'> = {
      $path: `/group/${groupId}/send`,
      postType: 'send',
      sendType: 'group',
      message,
      groupId,
    }
    await this.app.dispatchMeta(meta)
    return response.messageId as number
  }

  async sendDiscussMsg (discussId: number, message: string, autoEscape?: boolean) {
    if (!discussId || !message) return
    this.messages[0] += 1
    const response = await this._post('send_discuss_msg', { discussId, message, autoEscape })
    const meta: Meta<'send'> = {
      $path: `/discuss/${discussId}/send`,
      postType: 'send',
      sendType: 'discuss',
      message,
      discussId,
    }
    await this.app.dispatchMeta(meta)
    return response.messageId as number
  }

  async sendPrivateMsg (userId: number, message: string, autoEscape?: boolean) {
    if (!userId || !message) return
    this.messages[0] += 1
    const response = await this._post('send_private_msg', { userId, message, autoEscape })
    const meta: Meta<'send'> = {
      $path: `/user/${userId}/send`,
      postType: 'send',
      sendType: 'private',
      message,
      userId,
    }
    await this.app.dispatchMeta(meta)
    return response.messageId as number
  }

  async deleteMsg (messageId: number) {
    await this._post('delete_msg', { messageId })
  }

  async sendLike (userId: number, times = 1) {
    await this._post('send_like', { userId, times })
  }

  async setGroupKick (groupId: number, userId: number, rejectAddRequest = false) {
    await this._post('set_group_kick', { groupId, userId, rejectAddRequest })
  }

  async setGroupBan (groupId: number, userId: number, duration = 36 * 60) {
    await this._post('set_group_ban', { groupId, userId, duration })
  }

  setGroupAnonymousBan (groupId: number, anonymous: object, duration: number): Promise<void>
  setGroupAnonymousBan (groupId: number, flag: string, duration: number): Promise<void>
  async setGroupAnonymousBan (groupId: number, meta: object | string, duration = 36 * 60) {
    const args = { groupId, duration } as any
    args[typeof meta === 'string' ? 'flag' : 'anomymous'] = meta
    await this._post('set_group_anonymous_ban', args)
  }

  async setGroupWholeBan (groupId: number, enable = true) {
    await this._post('set_group_whole_ban', { groupId, enable })
  }

  async setGroupAdmin (groupId: number, userId: number, enable: boolean) {
    await this._post('set_group_admin', { groupId, userId, enable })
  }

  async setGroupAnonymous (groupId: number, enable: boolean) {
    await this._post('set_group_anonymous', { groupId, enable })
  }

  async setGroupCard (groupId: number, userId: number, card = '') {
    await this._post('set_group_admin', { groupId, userId, card })
  }

  async setGroupLeave (groupId: number, isDismiss = false) {
    await this._post('set_group_leave', { groupId, isDismiss })
  }

  async setGroupSpecialTitle (groupId: number, userId: number, specialTitle = '', duration = -1) {
    await this._post('set_group_special_title', { groupId, userId, specialTitle, duration })
  }

  async setDiscussLeave (discussId: number) {
    await this._post('set_discuss_leave', { discussId })
  }

  async setFriendAddRequest (flag: string, approve = true, remark = '') {
    await this._post('set_friend_add_request', { flag, approve, remark })
  }

  async setGroupAddRequest (flag: string, subType: 'add' | 'invite', approve = true, reason = '') {
    await this._post('set_group_add_request', { flag, subType, approve, reason })
  }

  getLoginInfo (): Promise<AccountInfo> {
    return this._post('get_login_info')
  }

  getStrangerInfo (userId: number, noCache = false): Promise<StrangerInfo> {
    return this._post('get_stranger_info', { userId, noCache })
  }

  getFriendList (): Promise<FriendInfo[]> {
    return this._post('get_friend_list')
  }

  getGroupList (): Promise<ListedGroupInfo[]> {
    return this._post('get_group_list')
  }

  getGroupInfo (groupId: string, noCache = false): Promise<GroupInfo> {
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

  async getRecord (file: string, outFormat: RecordFormat, fullPath = false) {
    const response = await this._post('get_record', { file, outFormat, fullPath })
    return response.file as string
  }

  async getImage (file: string) {
    const response = await this._post('get_image', { file })
    return response.file as string
  }

  async canSendImage () {
    const { yes } = await this._post('can_send_image')
    return yes as boolean
  }

  async canSendRecord () {
    const { yes } = await this._post('can_send_record')
    return yes as boolean
  }

  getStatus (): Promise<StatusInfo> {
    return this._post('get_status')
  }

  getVersionInfo (): Promise<VersionInfo> {
    return this._post('get_version_info')
  }

  async setRestartPlugin (delay = 0) {
    await this._post('set_restart_plugin', { delay })
  }

  async cleanDataDir (dataDir: DataDirectoryType) {
    await this._post('clean_data_dir', { dataDir })
  }

  async cleanPluginLog () {
    await this._post('clean_plugin_log')
  }
}
