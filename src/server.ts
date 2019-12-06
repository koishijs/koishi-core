import WebSocket from 'ws'
import express, { Response } from 'express'
import debug from 'debug'
import * as http from 'http'
import { json } from 'body-parser'
import { createHmac } from 'crypto'
import { camelCase } from 'koishi-utils'
import { Meta } from './meta'
import { App, AppOptions } from './app'
import { CQResponse } from './sender'

const showServerLog = debug('koishi:server')

// @ts-ignore: @types/debug does not include the property
showServerLog.inspectOpts.depth = 0

export abstract class Server {
  protected _apps: App[] = []
  private _appMap: Record<number, App> = {}
  private _isListening = false

  protected abstract _listen (): Promise<void>
  abstract close (): void

  constructor (app: App) {
    this.bind(app)
  }

  protected _handleData (data: any, res?: Response) {
    const meta = camelCase(data) as Meta
    if (!this._appMap[meta.selfId]) {
      const index = this._apps.findIndex(app => !app.options.selfId)
      if (index < 0) {
        if (res) res.sendStatus(403)
        return
      }
      this._appMap[meta.selfId] = this._apps[index]
      this._apps[index].options.selfId = meta.selfId
      this._apps[index]._registerSelfId()
    }
    const app = this._appMap[meta.selfId]
    if (res) res.sendStatus(200)
    showServerLog('receive %o', meta)
    app.dispatchMeta(meta)
  }

  bind (app: App) {
    this._apps.push(app)
    if (app.options.selfId) {
      this._appMap[app.options.selfId] = app
    }
    return this
  }

  async listen () {
    if (this._isListening) return
    this._isListening = true
    await this._listen()
    for (const app of this._apps) {
      app.receiver.emit('connected', app)
    }
  }
}

export class HttpServer extends Server {
  public express = express().use(json())
  public httpServer: http.Server

  constructor (app: App) {
    super(app)

    if (app.options.secret) {
      this.express.use((req, res, next) => {
        const signature = req.header('x-signature')
        if (!signature) return res.sendStatus(401)
        const body = JSON.stringify(req.body)
        const sig = createHmac('sha1', app.options.secret).update(body).digest('hex')
        if (signature !== `sha1=${sig}`) return res.sendStatus(403)
        return next()
      })
    }

    this.express.use((req, res) => {
      this._handleData(req.body, res)
    })
  }

  async _listen () {
    const { port } = this._apps[0].options
    this.httpServer = this.express.listen(port)
    showServerLog('listen to port', port)
  }

  close () {
    if (this.httpServer) this.httpServer.close()
    showServerLog('http server closed')
  }
}

let counter = 0

export class WsClient extends Server {
  public socket: WebSocket
  private _listeners: Record<number, Function> = {}

  constructor (app: App) {
    super(app)

    this.socket = new WebSocket(app.options.wsServer, {
      headers: {
        Authorization: `Bearer ${app.options.token}`,
      },
    })

    this.socket.on('message', (data) => {
      data = data.toString()
      let parsed: any
      try {
        parsed = JSON.parse(data)
      } catch (error) {
        throw new Error(data)
      }
      if ('post_type' in parsed) {
        this._handleData(parsed)
      } else if (parsed.echo in this._listeners) {
        this._listeners[parsed.echo](parsed)
      }
    })
  }

  send (data: any): Promise<CQResponse> {
    data.echo = ++counter
    return new Promise((resolve, reject) => {
      this._listeners[counter] = resolve
      this.socket.send(JSON.stringify(data), (error) => {
        if (error) reject(error)
      })
    })
  }

  async _listen () {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
    const { wsServer } = this._apps[0].options
    showServerLog('connect to ws server:', wsServer)
  }

  close () {
    if (this.socket) this.socket.close()
    showServerLog('ws client closed')
  }
}

export type ServerType = 'http' | 'ws' // 'ws-reverse'

const typeMap: Record<ServerType, [keyof AppOptions, Record<keyof any, Server>, new (app: App) => Server]> = {
  http: ['port', {}, HttpServer],
  ws: ['wsServer', {}, WsClient],
}

export function createServer (app: App) {
  const { type } = app.options
  if (!typeMap[type]) {
    throw new Error(`server type "${type}" is not supported`)
  }
  const [key, serverMap, Server] = typeMap[type]
  const value = app.options[key] as any
  if (!value) {
    throw new Error(`missing configuration "${key}"`)
  }
  if (value in serverMap) {
    return serverMap[value].bind(app)
  }
  return serverMap[value] = new Server(app)
}
