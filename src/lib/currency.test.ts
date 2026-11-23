import { defaultCurrencyList, getCurrency } from './currency'

describe('Traditional Chinese currency names', () => {
  it('uses zh-TW names in the currency list', () => {
    const currencies = defaultCurrencyList('zh-TW')

    expect(currencies.find(({ code }) => code === 'EUR')?.name).toBe('歐元')
    expect(currencies.find(({ code }) => code === 'JPY')?.name).toBe('日圓')
    expect(currencies.find(({ code }) => code === 'TWD')?.name).toBe('新台幣')
  })

  it('uses zh-TW names when retrieving one currency', () => {
    expect(getCurrency('CNY', 'zh-TW').name).toBe('人民幣')
  })
})
