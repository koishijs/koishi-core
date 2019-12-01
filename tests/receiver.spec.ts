import { SERVER_URL, CLIENT_PORT, createServer, postMeta } from './utils'
import { createApp, App, Meta } from '../src'
import { Server } from 'http'

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
    port: CLIENT_PORT,
    sendURL: SERVER_URL,
    selfId: 514,
  })

  app.start()
})

afterAll(() => {
  server.close()
  app.close()
})

describe('receiver', () => {
  const mocks: jest.Mock[] = []
  for (let index = 0; index < 11; ++index) {
    mocks.push(jest.fn())
  }

  beforeAll(() => {
    app.receiver.on('message', mocks[0])
    app.receiver.on('message/friend', mocks[1])
    app.receiver.on('message/normal', mocks[2])
    app.users.receiver.on('message', mocks[3])
    app.users.receiver.on('message/friend', mocks[4])
    app.user(10000).receiver.on('message', mocks[5])
    app.user(10000).receiver.on('message/friend', mocks[6])
    app.groups.receiver.on('message', mocks[7])
    app.groups.receiver.on('message/normal', mocks[8])
    app.group(10000).receiver.on('message', mocks[9])
    app.group(10000).receiver.on('message/normal', mocks[10])
  })

  test('friend', async () => {
    await postMeta({
      ...shared,
      messageType: 'private',
      subType: 'friend',
      message: 'Hello',
    })

    mocks.slice(0, 2).forEach(func => expect(func).toBeCalledTimes(1))
    mocks.slice(2, 3).forEach(func => expect(func).toBeCalledTimes(0))
    mocks.slice(3, 7).forEach(func => expect(func).toBeCalledTimes(1))
    mocks.slice(7, 11).forEach(func => expect(func).toBeCalledTimes(0))
  })

  test('group', async () => {
    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'World',
    })

    mocks.slice(0, 1).forEach(func => expect(func).toBeCalledTimes(2))
    mocks.slice(1, 3).forEach(func => expect(func).toBeCalledTimes(1))
    mocks.slice(3, 11).forEach(func => expect(func).toBeCalledTimes(1))
  })
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

    app.middleware((_, next) => {
      flag |= 1 << 0
      return next()
    }, 0)
  })

  test('middleware', async () => {
    await postMeta({
      ...shared,
      messageType: 'private',
      subType: 'friend',
      message: 'foo',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1101')
  })

  test('middleware', async () => {
    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'bar',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1011')
  })

  test('middleware', async () => {
    await postMeta({
      ...shared,
      messageType: 'private',
      subType: 'friend',
      message: 'baz',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('1101011')
  })

  test('middleware', async () => {
    await postMeta({
      ...shared,
      messageType: 'group',
      subType: 'normal',
      message: 'baz',
    })

    expect(flag.toString(2).split('').reverse().join('')).toBe('10111')
  })
})
