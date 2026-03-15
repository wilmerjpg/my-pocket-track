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

export async function getExpectedData() {
  const sheets = getSheets()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_EXPECTED_SHEET_ID!,
    range: `Expected!A:G`,
  })
  return res.data.values || []
}

export async function appendExpense(month: string, row: string[]) {
  const sheets = getSheets()
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${month}!A:G`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  })
}
