import {
  addExpense,
  createGroup,
  expectBalance,
  expenseCard,
  openTab,
  reimbursementRow,
  uniqueSuffix,
} from './app'
import { expect, test } from './fixtures'
import { money } from './ui'

test('settles a debt through "Mark as paid"', async ({ page }) => {
  // Two participants, so the suggested reimbursement is unique and deterministic.
  const groupId = await createGroup(page, {
    name: `E2E Reimbursement ${uniqueSuffix()}`,
    participants: ['Alice', 'Bob'],
  })

  await addExpense(page, groupId, {
    title: 'Hotel',
    amount: '100',
    paidBy: 'Alice',
  })

  await openTab(page, 'Balances')
  await expectBalance(page, 'Alice', 50)
  await expectBalance(page, 'Bob', -50)

  const row = reimbursementRow(page, 'Bob', 'Alice')
  await expect(row).toContainText('Bob owes Alice')
  await expect(row).toContainText(money(50))

  // Marking as paid records the repayment directly, after a confirmation.
  await row.getByRole('button', { name: 'Mark as paid' }).click()
  await expect(page.getByText(/Record that Bob paid Alice/)).toBeVisible()
  await page.getByRole('button', { name: 'Record payment' }).click()

  await expectBalance(page, 'Alice', 0)
  await expectBalance(page, 'Bob', 0)
  await expect(page.getByText(/doesn.t need any reimbursement/)).toBeVisible()

  await openTab(page, 'Expenses')
  const card = expenseCard(page, 'Reimbursement')
  await expect(card).toBeVisible()
  await expect(card).toContainText(money(50))
})
