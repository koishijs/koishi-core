import { createApp, App, Command, ParsedResult } from '../src'

let app: App, cmd1: Command, result: ParsedResult

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
})
