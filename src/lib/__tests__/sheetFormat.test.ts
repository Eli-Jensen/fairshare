import { describe, it, expect } from 'vitest'
import {
  desiredSheets,
  createSheetProperties,
  formatRequests,
  formatRequestsForSheet,
  structuralDiff,
  PEOPLE_COLUMN_COUNT,
} from '../sheetFormat'
import type { DesiredSheet } from '../sheetFormat'
import { buildSnapshot, snapshotToGrids, TABS } from '../sheetSnapshot'
import type { SheetLayout } from '../sheetSnapshot'
import type { SheetProperties } from '../sheetsApi'
import { tripFixture, expensesFixture, membersFixture, PARTICIPANTS } from './sheetFixture'

/**
 * These pin down the sizing rules, because getting them wrong doesn't look like
 * a formatting bug — an undersized grid makes the whole value write fail with
 * "exceeds grid limits", and an empty diff is what keeps a routine sync down to
 * two API calls.
 */

function fixtureLayout(): { layout: SheetLayout; rowCounts: Record<string, number> } {
  const snapshot = buildSnapshot({
    trip: tripFixture(),
    expenses: expensesFixture(),
    members: membersFixture(),
    participants: PARTICIPANTS,
    currentUid: 'alice',
    exportedAt: '2026-07-29T00:00:00.000Z',
  })
  const { grids, layout } = snapshotToGrids(snapshot)
  const rowCounts = Object.fromEntries(
    grids.map((g) => [g.title.toLowerCase(), g.values.length])
  )
  return { layout, rowCounts }
}

function currentSheets(desired: DesiredSheet[]): SheetProperties[] {
  return desired.map((d) => ({
    sheetId: d.sheetId,
    title: d.title,
    index: d.index,
    hidden: d.hidden,
    gridProperties: {
      rowCount: d.rowCount,
      columnCount: d.columnCount,
      frozenRowCount: d.frozenRowCount,
    },
  }))
}

function build() {
  const { layout, rowCounts } = fixtureLayout()
  const desired = desiredSheets(layout, {
    expenses: rowCounts.expenses,
    people: rowCounts.people,
    summary: rowCounts.summary,
    meta: rowCounts.meta,
  })
  return { layout, rowCounts, desired }
}

describe('desiredSheets', () => {
  const { layout, rowCounts, desired } = build()

  it('sizes the Expenses grid to exactly the data written', () => {
    const expenses = desired[0]
    expect(expenses.rowCount).toBe(rowCounts.expenses)
    expect(expenses.columnCount).toBe(layout.expensesColumnCount)
  })

  it('keeps Meta hidden and the rest visible', () => {
    expect(desired.map((d) => d.hidden)).toEqual([false, false, false, true])
  })

  it('never sizes a grid smaller than its frozen rows', () => {
    // Sheets rejects a grid that can't hold its own frozen header
    const tiny = desiredSheets(layout, { expenses: 0, people: 1, summary: 0, meta: 2 })
    for (const sheet of tiny) {
      expect(sheet.rowCount).toBeGreaterThan(sheet.frozenRowCount)
    }
  })

  it('assigns stable ids and ordering', () => {
    expect(desired.map((d) => d.sheetId)).toEqual([1, 2, 3, 4])
    expect(desired.map((d) => d.index)).toEqual([0, 1, 2, 3])
  })
})

describe('createSheetProperties', () => {
  it('describes every tab for the create call', () => {
    const { desired } = build()
    const sheets = createSheetProperties(desired)
    expect(sheets).toHaveLength(4)
    expect(sheets[0].properties.title).toBe('Expenses')
    expect(sheets[0].properties.gridProperties?.frozenRowCount).toBe(2)
    expect(sheets[3].properties.hidden).toBe(true)
  })
})

describe('structuralDiff', () => {
  const { desired } = build()

  it('asks for nothing when the sheet already matches', () => {
    // The property that keeps a routine sync at two API calls
    const diff = structuralDiff(currentSheets(desired), desired)
    expect(diff.requests).toEqual([])
    expect(diff.recreated).toEqual([])
  })

  it('grows a grid that is too small', () => {
    const actual = currentSheets(desired)
    actual[0].gridProperties = { rowCount: 1000, columnCount: 26, frozenRowCount: 2 }
    const diff = structuralDiff(actual, desired)
    expect(diff.requests).toHaveLength(1)
    const update = diff.requests[0].updateSheetProperties as Record<string, unknown>
    expect(update.fields).toBe(
      'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount'
    )
    const properties = update.properties as { sheetId: number; gridProperties: { columnCount: number } }
    expect(properties.sheetId).toBe(TABS.expenses.sheetId)
    expect(properties.gridProperties.columnCount).toBe(desired[0].columnCount)
  })

  it('shrinks a grid that is too big, which is also how stale rows are cleared', () => {
    const actual = currentSheets(desired)
    actual[0].gridProperties = { rowCount: 5000, columnCount: 80, frozenRowCount: 2 }
    const diff = structuralDiff(actual, desired)
    const properties = (diff.requests[0].updateSheetProperties as Record<string, unknown>)
      .properties as { gridProperties: { rowCount: number } }
    expect(properties.gridProperties.rowCount).toBe(desired[0].rowCount)
  })

  it('restores a frozen header the user unfroze', () => {
    const actual = currentSheets(desired)
    actual[1].gridProperties = { ...actual[1].gridProperties, frozenRowCount: 0 }
    expect(structuralDiff(actual, desired).requests).toHaveLength(1)
  })

  it('renames a tab back, because value writes address ranges by title', () => {
    const actual = currentSheets(desired)
    actual[0].title = 'My expenses'
    const diff = structuralDiff(actual, desired)
    expect(diff.requests).toHaveLength(1)
    const update = diff.requests[0].updateSheetProperties as Record<string, unknown>
    expect(update.fields).toBe('title')
    expect((update.properties as { title: string }).title).toBe('Expenses')
    // A rename alone is not a recreate — the data is still there
    expect(diff.recreated).toEqual([])
  })

  it('re-adds a deleted tab and reports it for reformatting', () => {
    const actual = currentSheets(desired).filter((s) => s.sheetId !== TABS.people.sheetId)
    const diff = structuralDiff(actual, desired)
    expect(diff.requests).toHaveLength(1)
    const add = diff.requests[0].addSheet as { properties: SheetProperties }
    expect(add.properties.title).toBe('People')
    expect(add.properties.gridProperties?.columnCount).toBe(PEOPLE_COLUMN_COUNT)
    expect(diff.recreated).toEqual([TABS.people.sheetId])
  })

  it('handles a tab that was both renamed and resized', () => {
    const actual = currentSheets(desired)
    actual[0].title = 'Renamed'
    actual[0].gridProperties = { rowCount: 10, columnCount: 5, frozenRowCount: 2 }
    const diff = structuralDiff(actual, desired)
    expect(diff.requests).toHaveLength(2)
  })

  it('reports every damaged tab in one batch', () => {
    const actual = currentSheets(desired).filter((s) => s.sheetId === TABS.expenses.sheetId)
    const diff = structuralDiff(actual, desired)
    expect(diff.recreated).toEqual([2, 3, 4])
  })
})

describe('formatRequests', () => {
  const { layout } = build()
  const requests = formatRequests(layout)

  it('hides the machine-key row on every tab', () => {
    const hiddenRows = requests.filter((r) => {
      const d = r.updateDimensionProperties as
        | { range: { dimension: string; startIndex: number }; properties: { hiddenByUser?: boolean } }
        | undefined
      return d?.range.dimension === 'ROWS' && d.properties.hiddenByUser === true
    })
    expect(hiddenRows).toHaveLength(4)
  })

  it('hides the trailing id columns, and only those', () => {
    const hidden = requests.find((r) => {
      const d = r.updateDimensionProperties as
        | { range: { dimension: string; startIndex: number }; properties: { hiddenByUser?: boolean } }
        | undefined
      return d?.range.dimension === 'COLUMNS' && d.properties.hiddenByUser === true
    })
    const range = (hidden!.updateDimensionProperties as { range: { startIndex: number; endIndex: number } }).range
    expect(range.startIndex).toBe(layout.machineColumnStart)
    expect(range.endIndex).toBe(layout.expensesColumnCount)
  })

  it('formats the money block from the settled amount through the last share column', () => {
    const currency = requests.find((r) => {
      const c = r.repeatCell as
        | { range: { sheetId: number; startColumnIndex: number }; cell: { userEnteredFormat?: { numberFormat?: { type: string } } } }
        | undefined
      return (
        c?.range.sheetId === TABS.expenses.sheetId &&
        c.cell.userEnteredFormat?.numberFormat?.type === 'CURRENCY'
      )
    })
    const range = (currency!.repeatCell as { range: { startColumnIndex: number; endColumnIndex: number } }).range
    expect(range.startColumnIndex).toBe(8)
    expect(range.endColumnIndex).toBe(layout.machineColumnStart)
  })

  it('uses the trip currency, not a hardcoded dollar sign', () => {
    const currencyPatterns = (requestList: ReturnType<typeof formatRequests>) =>
      requestList
        .map((r) => {
          const c = r.repeatCell as
            | { cell: { userEnteredFormat?: { numberFormat?: { type: string; pattern: string } } } }
            | undefined
          const format = c?.cell.userEnteredFormat?.numberFormat
          return format?.type === 'CURRENCY' ? format.pattern : null
        })
        .filter(Boolean)

    expect(currencyPatterns(requests)).toEqual(['"$"#,##0.00', '"$"#,##0.00'])
    expect(
      currencyPatterns(formatRequests({ ...layout, settlementCurrency: 'EUR' }))
    ).toEqual(['"€"#,##0.00', '"€"#,##0.00'])
  })

  it('leaves the filter open-ended so it survives changing row counts', () => {
    const filter = requests.find((r) => r.setBasicFilter)!
    const range = (filter.setBasicFilter as { filter: { range: Record<string, number> } }).filter.range
    expect(range.endRowIndex).toBeUndefined()
    expect(range.endColumnIndex).toBe(layout.machineColumnStart)
  })
})

describe('formatRequestsForSheet', () => {
  const { layout } = build()

  it('picks out only the requests for a recreated tab', () => {
    const people = formatRequestsForSheet(layout, TABS.people.sheetId)
    expect(people.length).toBeGreaterThan(0)
    for (const request of people) {
      expect(JSON.stringify(request)).toContain(`"sheetId":${TABS.people.sheetId}`)
    }
  })

  it('covers every tab between them', () => {
    const total = [1, 2, 3, 4].reduce(
      (sum, id) => sum + formatRequestsForSheet(layout, id).length,
      0
    )
    expect(total).toBe(formatRequests(layout).length)
  })
})
