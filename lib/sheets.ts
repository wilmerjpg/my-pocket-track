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

export async function getExpectedData(month: string) {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_EXPECTED_SHEET_ID!,
    range: `${month}!A:H`,
  })
  return res.data.values || []
}

export async function appendExpense(month: string, row: string[]) {
  const sheets = getSheets()
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!

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
    range: `${month}!A${targetRow}:G${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  })
}
