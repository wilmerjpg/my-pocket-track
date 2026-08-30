import { google } from 'googleapis'

const getSheets = () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

export async function getMonthData(month: string) {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${month}!A:G`,
  })
  return res.data.values || []
}

/** Pestaña del spreadsheet de pagos esperados que contiene la lista canónica. */
const EXPECTED_TAB = 'Pagos'

/**
 * Filas crudas de la hoja de pagos esperados, encabezados incluidos.
 * Interpretarlas es responsabilidad de `lib/expected.ts`.
 */
export async function getExpectedRows() {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_EXPECTED_SHEET_ID!,
    range: `${EXPECTED_TAB}!A:N`,
  })
  return res.data.values || []
}

/**
 * Vista plana de los gastos de un mes para pasárselos a Claude.
 * Centraliza el orden de columnas de la hoja de gastos (A:G).
 */
export function toExpenseRecords(month: string, rows: string[][]) {
  return rows
    .slice(1)
    .filter(row => row[0] && row[1])
    .map(row => ({
      month,
      owner: row[0],
      category: row[1],
      type: row[2],
      paymentMethod: row[3],
      description: row[4],
      amount: row[5],
      date: row[6],
    }))
}

export async function ensureMonthSheet(month: string) {
  const sheets = getSheets()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId })
  const sheetList = spreadsheet.data.sheets || []

  const exists = sheetList.some(s => s.properties?.title === month)
  if (exists) return

  const templateSheet = sheetList.find(s => s.properties?.title === 'Template')
  if (!templateSheet?.properties?.sheetId) throw new Error('Template sheet not found')

  const duplicateRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        duplicateSheet: {
          sourceSheetId: templateSheet.properties.sheetId,
          newSheetName: month,
        },
      }],
    },
  })

  // Move the new sheet to the end (after the last sheet)
  const newSheetId = duplicateRes.data.replies?.[0]?.duplicateSheet?.properties?.sheetId
  if (newSheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: newSheetId, index: sheetList.length },
            fields: 'index',
          },
        }],
      },
    })
  }
}

export async function appendExpenses(month: string, rows: string[][]) {
  if (rows.length === 0) return

  const sheets = getSheets()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!

  await ensureMonthSheet(month)

  // Read column A to find the first empty row (before summary rows)
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${month}!A:A`,
  })
  const values = colA.data.values || []

  // Find first empty row after header (findIndex returns 0-based, sheet rows are 1-based)
  const emptyIndex = values.findIndex((cell, i) => i > 0 && (!cell || !cell[0]))
  const targetRow = emptyIndex >= 0 ? emptyIndex + 1 : values.length + 1

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${month}!A${targetRow}:G${targetRow + rows.length - 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  })
}

export async function appendExpense(month: string, row: string[]) {
  return appendExpenses(month, [row])
}

export async function deleteLastExpense(month: string): Promise<string[] | null> {
  const sheets = getSheets()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!

  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${month}!A:G`,
  })
  const values = colA.data.values || []

  // Find last row with data (skip header)
  let lastRow = -1
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i][0]) { lastRow = i; break }
  }
  if (lastRow < 1) return null

  const deletedRow = values[lastRow]
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${month}!A${lastRow + 1}:G${lastRow + 1}`,
  })
  return deletedRow
}

export async function updateLastExpenseAmount(month: string, newAmount: string): Promise<string[] | null> {
  const sheets = getSheets()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!

  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${month}!A:G`,
  })
  const values = colA.data.values || []

  let lastRow = -1
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i][0]) { lastRow = i; break }
  }
  if (lastRow < 1) return null

  const originalRow = [...values[lastRow]]
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${month}!F${lastRow + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[newAmount]] },
  })
  return originalRow
}
