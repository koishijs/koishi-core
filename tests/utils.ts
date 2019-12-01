import express, { Express } from 'express'
import { EventEmitter } from 'events'
import { createHmac } from 'crypto'
import { Meta } from '../src'
import axios from 'axios'

const SERVER_PORT = 15700
export const MAX_TIMEOUT = 1000
export const CLIENT_PORT = 17070
export const SERVER_URL = `http://localhost:${SERVER_PORT}`

let app: Express
const emitter = new EventEmitter()

export function createServer () {
  app = express()

  app.get('/:method', (req, res) => {
    emitter.emit(req.params.method, req.query)
    res.sendStatus(200)
  })

  return app.listen(SERVER_PORT)
}

export async function postMeta (meta: Meta, port = CLIENT_PORT, secret?: string) {
  const headers: object = {}
  if (secret) {
    headers['X-Signature'] = 'sha1=' + createHmac('sha1', secret).update(JSON.stringify(meta)).digest('hex')
  }
  return axios.post(`http://localhost:${port}`, meta, { headers })
}

export async function waitFor (method: string) {
  return new Promise((resolve, reject) => {
    const listener = (query: any) => {
      clearTimeout(timer)
      resolve(query)
    }
    emitter.on(method, listener)
    const timer = setTimeout(() => {
      emitter.off(method, listener)
      reject()
    }, MAX_TIMEOUT)
  })
}
