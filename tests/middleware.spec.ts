import { SERVER_URL, CLIENT_PORT, createServer, postMeta } from './utils'
import { createApp, App, Meta } from '../src'
import { Server } from 'http'
import { sleep } from 'koishi-utils'
import * as errors from '../src/errors'

let app: App
let server: Server

jest.setTimeout(1000)

const shared: Meta = {
  postType: 'message',
  userId: 10000,
  selfId: 514,
}

beforeAll(() => {
  server = createServer()

  app = createApp({
    type: 'http',
    port: CLIENT_PORT,
    sendUrl: SERVER_URL,
    selfId: 514,
  })

  app.start()
})

afterAll(() => {
  server.close()
  app.stop()
})

describe('middleware', () => {
  let flag: number

  beforeEach(() => flag = 0)

  beforeAll(() => {
    app.users.middleware((_, next) => {
      flag |= 1 << 1
      return next()
    })

    app.groups.middleware(({ message }, next) => {
      flag |= 1 << 2
      if (message === 'foo') return
      if (message === 'bar') return next()
      return next(() => (flag |= 1 << 4, undefined))
    })

    app.middleware(({ message }, next) => {
      flag |= 1 << 3
      if (message === 'foo') return next()
      if (message === 'bar') return
      return next(next => (flag |= 1 << 5, next(() => (flag |= 1 << 6, undefined))))
    })

    app.premiddleware((_, next) => {
      flag |= 1 << 0
      return next()
    })
  })

  test('middleware-1', async () => {
    await postMeta({
      ...shared,
      messageType: 'private',
      subType: 'friend',
      message: 'foo',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1101')
  })

  test('middleware-2', async () => {
    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'bar',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1011')
  })

  test('middleware-3', async () => {
    await postMeta({
      ...shared,
      messageType: 'private',
      subType: 'friend',
      message: 'baz',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1101011')
  })

  test('middleware-4', async () => {
    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'baz',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('10111')
  })
})

describe('runtime checks', () => {
  let fn: jest.Mock

  beforeEach(() => {
    fn = jest.fn()
    // @ts-ignore
    app._middlewares = [['/', app._preprocess]]
    app.receiver.on('warning', error => fn(error.message))
  })

  test('premiddleware interception', async () => {
    app.premiddleware((meta, next) => {})

    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'foo',
    })

    expect(fn).toBeCalledWith(errors.PREMIDDLEWARE_INTERCEPTION)
  })

  test('isolated next function', async () => {
    app.middleware(async (_, next) => {
      next()
    })

    app.middleware(async (_, next) => {
      await sleep(0)
      next()
    })

    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'bar',
    })

    await sleep(0)

    expect(fn).toBeCalledWith(errors.ISOLATED_NEXT)
  })
})