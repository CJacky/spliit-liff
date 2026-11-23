// @ts-nocheck
import fs from 'node:fs'
import { Locale, locales } from '@/i18n/request'
import {
  Currency,
  supportedCurrencyCodes,
  supportedCurrencyCodeType,
} from '@/lib/currency'
import CurrencyList from 'currency-list'

const currencyList = locales.reduce((curList, locale) => {
  const currencyData = supportedCurrencyCodes.reduce(
    (curData, currencyCode) => {
      try {
        return {
          ...curData,
          [currencyCode]: CurrencyList.get(
            currencyCode,
            locale.replaceAll('-', '_'),
          ),
        }
      } catch {
        // For currency translations which are not found in the library (e.g. ua), use English.
        return {
          ...curData,
          [currencyCode]: CurrencyList.get(currencyCode, 'en_US'),
        }
      }
    },
    {},
  )
  return { ...curList, [locale]: currencyData }
}, {}) as {
  [K in Locale]: {
    [K in supportedCurrencyCodeType]: Currency
  }
}

const zhTwCurrencyNames = new Intl.DisplayNames(['zh-TW'], { type: 'currency' })
for (const currency of Object.values(currencyList['zh-TW'])) {
  currency.name = zhTwCurrencyNames.of(currency.code) ?? currency.name
}

fs.writeFileSync(
  'src/lib/currency-data.json',
  JSON.stringify(currencyList, null, 2) + '\n',
)
