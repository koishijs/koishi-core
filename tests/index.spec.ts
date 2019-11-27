import { SERVER_PORT, CLIENT_PORT, createServer, post } from './utils'
import { createApp, App } from '../src'
import { Server } from 'http'

let app: App
let server: Server

jest.setTimeout(1000)

beforeAll(() => {
  server = createServer(SERVER_PORT)

  app = createApp({
    port: CLIENT_PORT,
    name: '四季酱',
    sendURL: `http://localhost:${SERVER_PORT}`,
    selfId: 10000,
  })

  app.start()
})

afterAll(() => {
  server.close()
  app.close()
})

test('receiver', async () => {
  await post({
    postType: 'message',
    userId: 11111,
    messageType: 'private',
    message: 'Hello World',
  })

  expect(1).toBe(1)
})
