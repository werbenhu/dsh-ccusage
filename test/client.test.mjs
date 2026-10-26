import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * client.js 依赖 DSH 的 ModuleLoader 与 shell 注入的 react。
 * 这里用最小桩执行一遍，验证 bundle 形状、locale 注册和两个 slot 的注册参数。
 */
test('client bundle 能被 ModuleLoader 加载并注册槽位', async () => {
  const loaded = []
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        loaded.push(definition)
      },
    },
  }
  const React = {
    createElement() { return null },
    useState() { return [undefined, () => {}] },
    useEffect() {},
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
    useRef() { return { current: undefined } },
  }
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const execute = new Function('window', 'require', 'document', source)
  execute(globalThis.window, (id) => {
    assert.equal(id, 'react')
    return React
  }, { getElementById() { return null }, head: { appendChild() {} }, createElement() { return {} } })

  assert.equal(loaded.length, 1)
  const definition = loaded[0]
  assert.equal(definition.id, 'dsh-ccusage')

  const module = definition.factory((id) => {
    assert.equal(id, 'react')
    return React
  })
  assert.equal(module.name, 'ccusage')
  assert.deepEqual(module.inject, ['slots', 'locale'])

  const locales = []
  const slots = []
  const ctx = {
    locale: {
      register(namespace, messages) {
        locales.push({ namespace, messages })
        return () => {}
      },
      bind(namespace) {
        return (key) => `${namespace}.${key}`
      },
    },
    slots: {
      inject(name, callback) { callback() },
      register(config) {
        slots.push({ config })
        return () => {}
      },
    },
    effect(fn) { return fn() },
  }
  module.apply(ctx)

  assert.equal(locales.length, 1)
  assert.equal(locales[0].namespace, 'dsh-ccusage')
  assert.ok(locales[0].messages.zh.nav)
  assert.ok(locales[0].messages.en.nav)
  assert.equal(slots.length, 2)
  assert.equal(slots[0].config.name, 'sidebar.panellist')
  assert.equal(slots[0].config.id, 'ccusage')
  assert.equal(slots[1].config.name, 'main')
  assert.equal(slots[1].config.key, 'ccusage')

  delete globalThis.window
})
