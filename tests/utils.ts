import express, { Express } from 'express'
import { EventEmitter } from 'events'
import { Meta } from '../src'
import axios from 'axios'

export const MAX_TIMEOUT = 1000
export const SERVER_PORT = 15700
export const CLIENT_PORT = 17070

let app: Express
const emitter = new EventEmitter()

export function createServer (port: number) {
  app = express()

  app.get('/:method', (req, res) => {
    emitter.emit(req.params.method, req.query)
    res.sendStatus(200)
  })

  return app.listen(port)
}

export async function post (meta: Meta) {
  return axios.post(`http://localhost:${CLIENT_PORT}`, meta)
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
