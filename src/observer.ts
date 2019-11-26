import debug from 'debug'

const showObserverLog = debug('app:observer')
const staticTypes = ['number', 'string', 'bigint', 'boolean', 'symbol', 'function']

function observeObject <T extends object> (target: T, label: string, update?: () => void): T {
  const proxy: Partial<T> = {}

  if (!update) {
    Object.defineProperty(target, '_diff', {
      value: {},
      writable: true,
    })
  }

  return new Proxy(target as Observed<T>, {
    get (target, key) {
      if (key in proxy) return proxy[key]
      const value = target[key]
      if (!value || staticTypes.includes(typeof value) || typeof key === 'string' && key.startsWith('_')) return value
      const _update = update || (() => {
        const hasKey = key in target._diff
        target._diff[key] = proxy[key]
        if (!hasKey) {
          showObserverLog(`[diff] ${label}: ${String(key)}`)
        }
      })
      if (Array.isArray(value)) {
        return proxy[key] = observeArray(value, label, _update)
      } else {
        return proxy[key] = observeObject(value, label, _update)
      }
    },
    set (target, key, value) {
      if (target[key] !== value) {
        if (update) {
          update()
        } else if (typeof key !== 'string' || !key.startsWith('_')) {
          const hasKey = key in target._diff
          target._diff[key] = value
          if (!hasKey) {
            showObserverLog(`[diff] ${label}: ${String(key)}`)
          }
        }
      }
      return Reflect.set(target, key, value)
    },
    deleteProperty (target, key) {
      if (update) {
        update()
      } else {
        delete target._diff[key]
      }
      return Reflect.deleteProperty(target, key)
    },
  })
}

function observeArray <T> (target: T[], label: string, update: () => void) {
  const proxy: Record<number, T> = {}

  return new Proxy(target, {
    get (target, key) {
      if (key in proxy) return proxy[key]
      const value = target[key]
      if (!value || staticTypes.includes(typeof value) || typeof key === 'symbol' || isNaN(key as any)) return value
      if (Array.isArray(value)) {
        return proxy[key] = observeArray(value, label, update)
      } else {
        return proxy[key] = observeObject(value, label, update)
      }
    },
    set (target, key, value) {
      if (typeof key !== 'symbol' && !isNaN(key as any) && target[key] !== value) update()
      return Reflect.set(target, key, value)
    },
  })
}

export type Observed <T, U = any> = T & {
  _diff: Partial<T>
  update: () => U
  merge: (value: Partial<T>) => Observed <T, U>
}

export function observe <T extends object, U> (target: T, label: string, update: (diff: Partial<T>) => U) {
  Object.defineProperty(target, 'update', {
    value (this: Observed<T, U>) {
      const diff = this._diff
      const fields = Object.keys(diff)
      if (fields.length) {
        showObserverLog(`[update] ${label}: ${fields.join(', ')}`)
        this._diff = {}
        return update(diff)
      }
    },
  })
  Object.defineProperty(target, 'merge', {
    value (value: Partial<T>) {
      Object.assign(target, value)
      return this
    },
  })
  return observeObject(target, label, null) as Observed<T, U>
}
