import { App, Command, errors } from '../src'

let app: App

jest.setTimeout(1000)

describe('register commands', () => {
  beforeAll(() => app = new App())

  test('context.command', () => {
    app.command('a')
    app.user(10000).command('b')
    app.group(10000).command('c')
  
    expect(app._commands).toHaveLength(3)
    expect(app._commandMap.a.context).toBe(app)
    expect(app._commandMap.b.context).toBe(app.user(10000))
    expect(app._commandMap.c.context).toBe(app.group(10000))
  })

  test('modify commands', () => {
    const d1 = app.command('d', 'foo', { authority: 1 })
    expect(app._commandMap.d.config.description).toBe('foo')
    expect(app._commandMap.d.config.authority).toBe(1)

    const d2 = app.command('d', { description: 'bar', authority: 2 })
    expect(app._commandMap.d.config.description).toBe('bar')
    expect(app._commandMap.d.config.authority).toBe(2)

    expect(d1).toBe(d2)
  })

  test('check names', () => {
    expect(() => app.command('<xyz>')).toThrow(errors.ERR_EXPECT_COMMAND_NAME)
    expect(() => app.command('xyz?123')).toThrow(errors.ERR_INVALID_CHARACTER)
    expect(() => app.command('w/x-y.z')).not.toThrow()
  })

  test('name conflicts', () => {
    expect(() => {
      app.command('e')
      app.user(10000).command('e')
    }).not.toThrow()

    expect(() => {
      app.user(10000).command('f')
      app.command('f')
    }).toThrow(errors.ERR_WRONG_CONTEXT)

    expect(() => {
      app.command('g').alias('x')
      app.command('h').alias('x')
    }).toThrow(errors.ERR_DUPLICATE_COMMAND)
  })
})

describe('register subcommands', () => {
  beforeAll(() => app = new App())
  let a: Command, b: Command, c: Command

  test('command.subcommand', () => {
    a = app.command('a')
    b = a.subcommand('b')
    c = b.subcommand('.c')
    expect(a.children).toMatchObject([b])
    expect(b.name).toBe('b')
    expect(b.parent).toBe(a)
    expect(b.children).toMatchObject([c])
    expect(c.name).toBe('b.c')
    expect(c.parent).toBe(b)
  })

  test('implicit subcommands', () => {
    const d = app.command('a.d')
    expect(d.name).toBe('a.d')
    expect(d.parent.name).toBe('a')
    expect(d.parent.parent).toBeNull()

    const e = app.command('x/e')
    expect(e.name).toBe('e')
    expect(e.parent.name).toBe('x')
    expect(e.parent.parent).toBeNull()

    const f = b.subcommand('y.f')
    expect(f.name).toBe('y.f')
    expect(f.parent.name).toBe('y')
    expect(f.parent.parent.name).toBe('b')

    const g = a.subcommand('z/g')
    expect(g.name).toBe('g')
    expect(g.parent.name).toBe('z')
    expect(g.parent.parent.name).toBe('a')
  })

  test('check existence', () => {
    expect(() => b.subcommand('x')).toThrow(errors.ERR_EXISTING_SUBCOMMAND)
    expect(() => app.command('e/x')).toThrow(errors.ERR_WRONG_SUBCOMMAND)
    expect(() => a.subcommand('d/e')).toThrow(errors.ERR_WRONG_SUBCOMMAND)
    expect(() => a.subcommand('d.e')).not.toThrow()
  })
})
