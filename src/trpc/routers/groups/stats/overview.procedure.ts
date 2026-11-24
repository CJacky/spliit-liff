import { getGroup, getGroupExpenses } from '@/lib/api'
import { getMonthlyCategorySpending } from '@/lib/monthly-spending'
import {
  filterExpensesByDateRange,
  getSpendingByCategory,
  getSpendingByParticipant,
  getSpendingOverTime,
  getSpendingSummary,
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
} from '@/lib/totals'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

/**
 * Single data-loader for the whole stats page. Fetches the group's expenses
 * once and derives every stats section from them, so loading the page (and
 * changing the date range) costs one request instead of one per card.
 */
export const getStatsOverviewProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      participantId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .query(async ({ input: { groupId, participantId, from, to } }) => {
    const [group, allExpenses] = await Promise.all([
      getGroup(groupId),
      getGroupExpenses(groupId),
    ])

    const expenses = filterExpensesByDateRange(allExpenses, from, to)
    const participants = group?.participants ?? []

    return {
      totalGroupSpendings: getTotalGroupSpending(expenses),
      totalParticipantSpendings:
        participantId !== undefined
          ? getTotalActiveUserPaidFor(participantId, expenses)
          : undefined,
      totalParticipantShare:
        participantId !== undefined
          ? getTotalActiveUserShare(participantId, expenses)
          : undefined,
      summary: getSpendingSummary(expenses),
      months: getSpendingOverTime(expenses),
      monthlyCategorySpending: getMonthlyCategorySpending(expenses, {
        grouping: 'category',
        from,
        to,
      }),
      participants: getSpendingByParticipant(participants, expenses),
      categories: getSpendingByCategory(expenses),
    }
  })
