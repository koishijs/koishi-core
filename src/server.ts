import WebSocket from 'ws'
import express from 'express'
import debug from 'debug'
import { Server as HttpServer } from 'http'
import { json } from 'body-parser'
import { createHmac } from 'crypto'
import { camelCase } from 'koishi-utils'
import { Meta } from './meta'
import { App } from './app'

const showServerLog = debug('koishi:server')

// @ts-ignore: @types/debug does not include the property
showServerLog.inspectOpts.depth = 0

const serverMap: Record<number, Server> = {}

export function createServer (app: App) {
  const { port } = app.options
  if (port in serverMap) {
    return serverMap[port].bind(app)
  }
  return serverMap[port] = new Server(app)
}

export class Server {
  private _apps: App[] = []
  private _appMap: Record<number, App> = {}
  private _server = express().use(json())
  private _socket: WebSocket
  private _httpServer: HttpServer
  private _isListening = false

  constructor (app: App) {
    if (app.options.wsServer) {
      this._socket = new WebSocket(app.options.wsServer + '/event', {
        headers: {
          Authorization: `Token ${app.options.token}`,
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
      if (!this._appMap[meta.selfId]) {
        const index = this._apps.findIndex(app => !app.options.selfId)
        if (index < 0) return res.sendStatus(403)
        this._appMap[meta.selfId] = this._apps[index]
        this._apps[index].options.selfId = meta.selfId
        this._apps[index]._registerSelfId()
      }
      const app = this._appMap[meta.selfId]
      res.sendStatus(200)
      showServerLog('receive %o', meta)
      await app.dispatchMeta(meta)
    })

    this.bind(app)
  }

  bind (app: App) {
    this._apps.push(app)
    if (app.options.selfId) {
      this._appMap[app.options.selfId] = app
    }
    return this
  }

  listen (port: number) {
    if (this._isListening) return
    this._isListening = true
    this._httpServer = this._server.listen(port)
    showServerLog('listen to port', port)
    for (const app of this._apps) {
      app.receiver.emit('connected', app)
    }
  }

  stop () {
    if (!this._httpServer) return
    this._httpServer.close()
    showServerLog('closed')
  }
}
