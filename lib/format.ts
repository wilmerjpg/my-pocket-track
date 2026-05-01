export const formatAmount = (v: string | number | undefined) =>
  `$${String(v ?? '').replace(/^\$/, '')}`
