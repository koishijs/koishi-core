import { App } from '../src'

let app: App

jest.setTimeout(1000)

beforeEach(() => {
  app = new App()
})

describe('register commands', () => {
  test('contexts', () => {
    app.command('a')
    app.user(10000).command('b')
    app.group(10000).command('c')
  
    expect(app._commands).toHaveLength(3)
    expect(app.getCommand('a').context).toBe(app)
    expect(app.getCommand('b').context).toBe(app.user(10000))
    expect(app.getCommand('c').context).toBe(app.group(10000))
  })

  test('modify commands', () => {
    const d1 = app.command('d', 'foo', { authority: 1 })
    expect(app.getCommand('d').config.description).toBe('foo')
    expect(app.getCommand('d').config.authority).toBe(1)

    const d2 = app.command('d', { description: 'bar', authority: 2 })
    expect(app.getCommand('d').config.description).toBe('bar')
    expect(app.getCommand('d').config.authority).toBe(2)

    expect(d1).toBe(d2)
  })

  test('name conflicts', () => {
    expect(() => {
      app.command('e')
      app.user(10000).command('e')
    }).not.toThrow()

    expect(() => {
      app.user(10000).command('f')
      app.command('f')
    }).toThrow('duplicate command names')
  })
})
