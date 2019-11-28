import WebSocket from 'ws'
import express from 'express'
import debug from 'debug'
import { Server as HttpServer } from 'http'
import { json } from 'body-parser'
import { createHmac } from 'crypto'
import { camelCase } from 'koishi-utils'
import { Meta } from './meta'
import { App } from './app'

export const showServerLog = debug('koishi:server')
export const showReceiverLog = debug('koishi:receiver')

// @ts-ignore: @types/debug does not include the property
showServerLog.inspectOpts.depth = 0

export default class Server {
  private _server = express().use(json())
  private _socket: WebSocket
  private _httpServer: HttpServer

  constructor (public app: App) {
    if (app.options.wsServer) {
      this._socket = new WebSocket(app.options.wsServer + '/event', {
        headers: {
          Authorization: `Token ${this.app.options.token}`,
        },
      })

      this._socket.on('message', (data) => {
        console.log(data)
      })
    }

    if (app.options.secret) {
      this._server.use((req, res, next) => {
        const signature = req.header('x-signature')
        if (!signature) return res.sendStatus(401)
        const body = JSON.stringify(req.body)
        const sig = createHmac('sha1', app.options.secret).update(body).digest('hex')
        if (signature !== `sha1=${sig}`) return res.sendStatus(403)
        return next()
      })
    }

    this._server.use(async (req, res) => {
      const meta = camelCase(req.body) as Meta
      showServerLog('receive %o', meta)
      res.sendStatus(200)

      try {
        await this.addProperties(meta)
        this.emitEvents(meta)
      } catch (error) {
        console.error(error)
      }
    })
  }

  emitEvents (meta: Meta) {
    for (const path in this.app.contexts) {
      const context = this.app.contexts[path]
      const types = context._getEventTypes(meta.$path)
      if (types.length) showReceiverLog(path, 'emits', types.join(', '))
      types.forEach(type => context.receiver.emit(type, meta))
    }
  }

  async addProperties (meta: Meta) {
    Object.defineProperty(meta, '$path', {
      value: '/',
      writable: true,
    })
    if (meta.postType === 'message') {
      const messageType = meta.messageType === 'private' ? 'user' : meta.messageType
      meta.$path += `${messageType}/${meta.groupId || meta.discussId || meta.userId}/message`
    } else if (meta.groupId) {
      meta.$path += `group/${meta.groupId}/${meta.requestType || meta.noticeType}`
    } else {
      meta.$path += `${meta.postType}/${meta.requestType || meta.noticeType || meta.metaEventType}`
    }
    if (meta.subType) meta.$path += '/' + meta.subType
    if (meta.userId && meta.messageType !== 'private') meta.$path += '/' + meta.userId
    showReceiverLog('path %s', meta.$path)

    // add context properties
    if (meta.postType === 'message') {
      if (meta.messageType === 'group') {
        if (this.app.database) {
          Object.defineProperty(meta, '$group', {
            value: await this.app.database.getGroup(meta.groupId),
            writable: true,
          })
        }
        meta.$send = message => this.app.sender.sendGroupMsg(meta.groupId, message)
      } else if (meta.messageType === 'discuss') {
        meta.$send = message => this.app.sender.sendDiscussMsg(meta.discussId, message)
      } else {
        meta.$send = message => this.app.sender.sendPrivateMsg(meta.userId, message)
      }
    }
  }

  listen (port: number) {
    this._httpServer = this._server.listen(port)
    showServerLog('listen to port', port)
    for (const path in this.app.contexts) {
      const context = this.app.contexts[path]
      context.receiver.emit('connected')
    }
  }

  close () {
    this._httpServer.close()
    showServerLog('closed')
  }
}
