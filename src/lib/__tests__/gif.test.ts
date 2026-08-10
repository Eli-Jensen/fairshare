import { describe, it, expect } from 'vitest'
import { parseKlipyResponse } from '../gif'

const entry = (url: string, w = 100, h = 80) => ({ url, width: w, height: h })

describe('parseKlipyResponse', () => {
  it('parses the documented shape, preferring md for storage and sm for preview', () => {
    const out = parseKlipyResponse({
      result: true,
      data: {
        data: [
          {
            id: 42,
            files: {
              hd: entry('https://cdn/hd.gif', 400, 300),
              md: entry('https://cdn/md.gif', 200, 150),
              sm: entry('https://cdn/sm.gif', 100, 75),
              xs: entry('https://cdn/xs.gif', 50, 38),
            },
          },
        ],
      },
    })
    expect(out).toEqual([
      {
        id: '42',
        previewUrl: 'https://cdn/sm.gif',
        url: 'https://cdn/md.gif',
        width: 200,
        height: 150,
      },
    ])
  })

  it('falls back across missing renditions (no md → hd; no sm → xs)', () => {
    const out = parseKlipyResponse({
      data: {
        data: [
          { id: 'a', files: { hd: entry('https://cdn/hd.gif'), xs: entry('https://cdn/xs.gif') } },
        ],
      },
    })
    expect(out[0].url).toBe('https://cdn/hd.gif')
    expect(out[0].previewUrl).toBe('https://cdn/xs.gif')
  })

  it('handles nested gif sub-entries ({files: {md: {gif: {url}}}})', () => {
    const out = parseKlipyResponse({
      data: { data: [{ id: 'n', files: { md: { gif: { url: 'https://cdn/nested.gif', width: 10, height: 5 } } } }] },
    })
    expect(out[0]).toMatchObject({ url: 'https://cdn/nested.gif', width: 10, height: 5 })
  })

  it('parses the LIVE KLIPY shape (singular `file`, renditions nested under gif/webp)', () => {
    // Captured 2026-07-08 from /gifs/trending with a real key.
    const size = (n: number) => ({
      gif: { url: `https://static.klipy.com/x/${n}.gif`, width: 498, height: 340, size: n },
      webp: { url: `https://static.klipy.com/x/${n}.webp`, width: 498, height: 340, size: n },
    })
    const out = parseKlipyResponse({
      result: true,
      data: {
        data: [
          {
            id: 12345,
            slug: 'some-gif',
            title: 'Some GIF',
            type: 'gif',
            blur_preview: 'data:image/webp;base64,xxx',
            file: { hd: size(1), md: size(2), sm: size(3), xs: size(4) },
          },
        ],
      },
    })
    expect(out).toEqual([
      {
        id: '12345',
        previewUrl: 'https://static.klipy.com/x/3.gif',
        url: 'https://static.klipy.com/x/2.gif',
        width: 498,
        height: 340,
      },
    ])
  })

  it('skips items without any usable rendition', () => {
    const out = parseKlipyResponse({
      data: { data: [{ id: 'empty', files: {} }, { id: 'ok', files: { md: entry('https://cdn/ok.gif') } }] },
    })
    expect(out.map((g) => g.id)).toEqual(['ok'])
  })

  it('returns [] on malformed or empty payloads', () => {
    expect(parseKlipyResponse(null)).toEqual([])
    expect(parseKlipyResponse({})).toEqual([])
    expect(parseKlipyResponse({ data: { data: 'nope' } })).toEqual([])
  })
})
