import { App, AppOptions } from './app'

export const assignees: number[] = []
export const apps: Record<number, App> = {}
export const cqFolders = new Set<string>()

export function addCQFolder (...folders: string[]) {
  for (const folder of folders) {
    cqFolders.add(folder)
  }
}

export function createApp (options: AppOptions) {
  const app = new App(options)
  apps[options.selfId] = app
  assignees.push(options.selfId)
  return app
}

export function each (callback: (app: App) => any) {
  for (const id in apps) {
    callback(apps[id])
  }
}

const onStartHooks = new Set<(...app: App[]) => void>()

export function onStart (callback: (...app: App[]) => void) {
  onStartHooks.add(callback)
}

export function start () {
  const appList: App[] = []
  for (const id in apps) {
    apps[id].start()
    appList.push(apps[id])
  }
  for (const callback of onStartHooks) {
    callback(...appList)
  }
}
