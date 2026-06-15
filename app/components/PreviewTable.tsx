'use client'

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'

export interface PreviewRow {
  readonly key: string
  readonly ok: boolean
  readonly fileName: string
  readonly account: string
  readonly category: string
  readonly template: string
  readonly reasons: readonly string[]
}

const column = createColumnHelper<PreviewRow>()

const columns = [
  column.accessor('ok', {
    header: 'Status',
    cell: (cell) =>
      cell.getValue() ? (
        <span className="pill pill--ok">valid</span>
      ) : (
        <span className="pill pill--fail">invalid</span>
      ),
  }),
  column.accessor('fileName', {
    header: 'File',
    cell: (cell) => <span className="cell-strong">{cell.getValue()}</span>,
  }),
  column.accessor('account', { header: 'Account' }),
  column.accessor('category', { header: 'Category' }),
  column.accessor('template', { header: 'Template' }),
  column.accessor('reasons', {
    header: 'Issues',
    cell: (cell) => {
      const reasons = cell.getValue()
      if (reasons.length === 0) {
        return <span className="field__note">—</span>
      }
      return (
        <div className="reasons">
          {reasons.map((reason) => (
            <span key={reason} className="chip">
              {reason}
            </span>
          ))}
        </div>
      )
    },
  }),
]

/** Read-only preview of pre-flight rows: valid rows and invalid rows (with their reasons). */
export function PreviewTable({ rows }: { rows: readonly PreviewRow[] }) {
  const table = useReactTable({
    // copy to satisfy TanStack's mutable `data` type without casting away `readonly`
    data: [...rows],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.original.ok ? undefined : 'row--invalid'}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
