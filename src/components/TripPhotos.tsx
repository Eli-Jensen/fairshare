import { useState } from 'react'
import type { Expense } from '../lib/types'
import { formatMoney } from '../lib/types'
import { formatDateOnly } from '../lib/dates'
import { ReceiptImage } from './ReceiptImage'
import { Lightbox } from './Lightbox'
import { imageUrl } from '../lib/image'

/**
 * Every receipt photo in the trip, newest expense first. No new collection —
 * the paths live on the expense docs the caller already loaded (the caller
 * MUST pass allExpenses: the default 20-doc listener window would silently
 * hide older receipts).
 */
export function TripPhotos({
  expenses,
  settlementCurrency,
  onOpenExpense,
}: {
  expenses: Expense[]
  settlementCurrency: string
  onOpenExpense: (expenseId: string) => void
}) {
  const [viewing, setViewing] = useState<{ src: string; expense: Expense } | null>(null)

  const photos = expenses
    .flatMap((e) => (e.receiptPaths ?? []).map((path) => ({ path, expense: e })))
    .sort(
      (a, b) =>
        (b.expense.date?.toMillis?.() ?? 0) - (a.expense.date?.toMillis?.() ?? 0) ||
        (b.expense.createdAt?.toMillis?.() ?? 0) - (a.expense.createdAt?.toMillis?.() ?? 0)
    )

  if (photos.length === 0) {
    return (
      <p className="py-16 text-center text-text-secondary">
        No receipts yet — attach photos when adding an expense.
      </p>
    )
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
        {photos.map(({ path, expense }) => (
          <ReceiptImage
            key={path}
            path={path}
            alt={`Receipt for ${expense.description}`}
            className="aspect-square w-full rounded-md"
            onClick={() =>
              imageUrl(path)
                .then((src) => setViewing({ src, expense }))
                .catch(() => {})
            }
          />
        ))}
      </div>

      {viewing && (
        <Lightbox
          src={viewing.src}
          alt={`Receipt for ${viewing.expense.description}`}
          caption={
            <button
              type="button"
              className="pointer-events-auto underline decoration-dotted"
              onClick={() => onOpenExpense(viewing.expense.id)}
            >
              {viewing.expense.description} · {formatMoney(viewing.expense.amountSettled, settlementCurrency)} ·{' '}
              {formatDateOnly(viewing.expense.date)}
            </button>
          }
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}
