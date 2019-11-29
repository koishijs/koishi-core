import { createApp, App, Command, ParsedResult } from '../src'

let app: App, cmd1: Command, cmd2: Command, result: ParsedResult

jest.setTimeout(1000)

beforeAll(() => {
  app = createApp({
    name: 'koishi',
    selfId: 514,
  })

  cmd1 = app
    .command('cmd1 <foo> [bar]')
    .option('-a, --alpha')
    .option('-b, --beta <beta>')

  cmd2 = app
    .command('cmd2 [foo] [bar...]')
    .option('-a [alpha]', '', { isString: true })
    .option('-b [beta]', '', { default: 1000 })
    .option('-C, --no-gamma')
    .option('-D, --no-delta')
})

describe('arguments', () => {
  test('normal arguments', () => {
    result = cmd1.parseLine('foo bar 123')
    expect(result.args).toMatchObject(['foo', 'bar', '123'])
  })

  test('insufficient arguments', () => {
    result = cmd1.parseLine('-a')
    expect(result.args).toMatchObject(['', ''])
  })

  test('hyphen-prefixed arguments', () => {
    result = cmd1.parseLine('-a "-a"')
    expect(result.args).toMatchObject(['-a', ''])
  })

  test('skip rest part', () => {
    result = cmd1.parseLine('foo bar baz -- 123 456')
    expect(result.rest).toBe('123 456')
    expect(result.args).toMatchObject(['foo', 'bar', 'baz'])
  })

  test('long argument', () => {
    result = cmd2.parseLine('foo bar baz -- 123 456')
    expect(result.rest).toBe('')
    expect(result.args).toMatchObject(['foo', 'bar baz -- 123 456'])
  })
})

describe('options', () => {
  test('option without parameter', () => {
    result = cmd1.parseLine('--alpha a')
    expect(result.args).toMatchObject(['a', ''])
    expect(result.options).toMatchObject({ a: true, alpha: true })
  })

  test('option with parameter', () => {
    result = cmd1.parseLine('--beta 10')
    expect(result.options).toMatchObject({ b: 10, beta: 10 })
  })

  test('quoted parameter', () => {
    result = cmd1.parseLine('-c "" -d')
    expect(result.options).toMatchObject({ c: '', d: true })
  })

  test('unknown options', () => {
    result = cmd1.parseLine('--unknown-gamma c -de 10')
    expect(result.unknown).toMatchObject(['unknown-gamma', 'd', 'e'])
    expect(result.options).toMatchObject({ unknownGamma: 'c', d: true, e: 10 })
  })

  test('negated options', () => {
    result = cmd2.parseLine('-C --no-delta -E --no-epsilon')
    expect(result.options).toMatchObject({ C: true, gamma: false, D: true, delta: false, E: true, epsilon: false })
  })

  test('option configuration', () => {
    result = cmd2.parseLine('-a 123 -bd 456')
    expect(result.options).toMatchObject({ a: '123', b: 1000, d: 456 })
  })
})
