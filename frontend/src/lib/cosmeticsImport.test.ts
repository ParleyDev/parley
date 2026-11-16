import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_FILE, okFileName, okFolderName, planImport, type PickedFile } from './cosmeticsImport'

const file = (body: string | number = 'x') => new File([typeof body === 'number' ? new Uint8Array(body) : body], 'f')
const meta = (items: unknown[]) => file(JSON.stringify({ source: 's', items, item_count: items.length }))

describe('planImport', () => {
  it('finds kind folders under the picked folder and matches each item with its files', async () => {
    const picked: PickedFile[] = [
      { path: 'export/avatar-decorations/metadata.json', file: meta([{ file: 'a_duck.png', name: 'a duck', price: { amount: 1 } }, { file: 'gone.png', name: 'Gone' }]) },
      { path: 'export/avatar-decorations/a_duck.png', file: file() },
      { path: 'export/avatar-decorations/stray.png', file: file() },
      { path: 'export/profile-effects/metadata.json', file: meta([{ folder: 'ace', name: 'ACE', layers: [{ file: 'layer_01.png' }] }]) },
      { path: 'export/profile-effects/ace/layer_01.png', file: file() },
      { path: 'export/profile-effects/ace/static.png', file: file() },
      { path: 'export/profile-effects/ace/.DS_Store', file: file() },
      { path: 'export/notes.txt', file: file() },
    ]
    const plans = await planImport(picked)
    expect(plans.map((p) => p.kind)).toEqual(['decoration', 'effect'])
    const [dec, eff] = plans
    expect(dec.items.map((i) => [i.key, i.problem, i.files.map((f) => f.name)])).toEqual([['a_duck.png', undefined, ['a_duck.png']], ['gone.png', 'no-files', []]])
    // The entry is kept as it is, fields Parley doesn't use included.
    expect(dec.items[0].entry).toEqual({ file: 'a_duck.png', name: 'a duck', price: { amount: 1 } })
    expect(eff.items[0].files.map((f) => f.name).sort()).toEqual(['layer_01.png', 'static.png'])
  })

  it('takes a kind folder picked on its own, and says when its metadata is missing or broken', async () => {
    const plans = await planImport([
      { path: 'nameplates/metadata.json', file: meta([{ file: 'clip.webm', name: 'Clip' }]) },
      { path: 'nameplates/clip.webm', file: file() },
      { path: 'x/profile-frames/raccoon/a.png', file: file() },
      { path: 'x/avatar-decorations/metadata.json', file: file('{nope') },
    ])
    expect(plans.find((p) => p.kind === 'nameplate')?.items[0].problem).toBeUndefined()
    expect(plans.find((p) => p.kind === 'frame')?.error).toBe('no-metadata')
    expect(plans.find((p) => p.kind === 'decoration')?.error).toBe('bad-metadata')
  })

  it('flags names the server would refuse, files over its limit, and repeated entries', async () => {
    const plans = await planImport([
      { path: 'avatar-decorations/metadata.json', file: meta([{ file: 'two words.png' }, { file: 'big.png' }, { file: 'ok.png' }, { file: 'ok.png' }]) },
      { path: 'avatar-decorations/two words.png', file: file() },
      { path: 'avatar-decorations/big.png', file: file(MAX_IMPORT_FILE + 1) },
      { path: 'avatar-decorations/ok.png', file: file() },
    ])
    expect(plans[0].items.map((i) => [i.key, i.problem])).toEqual([['two words.png', 'bad-name'], ['big.png', 'too-big'], ['ok.png', undefined]])
  })
})

describe('names', () => {
  it('follows the server', () => {
    expect(okFileName('nameplate', 'clip.webm')).toBe(true)
    expect(okFileName('decoration', 'clip.webm')).toBe(false)
    expect(okFileName('decoration', '.hidden.png')).toBe(false)
    expect(okFolderName('alt_raccoon')).toBe(true)
    expect(okFolderName('a.b')).toBe(false)
  })
})
