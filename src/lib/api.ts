import {
  ActivityType,
  Expense,
  RecurrenceRule,
  RecurringExpenseLink,
} from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import { nextRecurringDate, usesAnchorDay } from '@/lib/recurrence'
import { ExpenseFormValues, GroupFormValues } from '@/lib/schemas'

// Re-exported for backwards compatibility with existing server-side importers.
export { randomId }

export async function createGroup(groupFormValues: GroupFormValues) {
  // Members only join through LINE: the group starts with its creator alone,
  // linked to their LINE account, and the others join from the group page
  // (see createParticipantForLineUser).
  const creator = groupFormValues.participants[0]
  if (!creator?.lineUserId) {
    throw new Error('The group creator must be linked to a LINE account')
  }

  return prisma.group.create({
    data: {
      id: randomId(),
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
      creatorLineUserId: creator.lineUserId,
      participants: {
        create: {
          id: randomId(),
          name: creator.name,
          lineUserId: creator.lineUserId,
        },
      },
    },
    include: { participants: true },
  })
}

export async function createExpense(
  expenseFormValues: ExpenseFormValues,
  groupId: string,
  participantId?: string,
  // The expense form mints the id up front so the split it previews is the
  // one the saved expense gets (the id seeds who takes the leftover minor
  // unit, see `getExpenseShares`).
  expenseId: string = randomId(),
): Promise<Expense> {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  await logActivity(groupId, ActivityType.CREATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isCreateRecurrence =
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE
  const recurringExpenseLinkPayload = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  return prisma.expense.create({
    data: {
      id: expenseId,
      groupId,
      expenseDate: expenseFormValues.expenseDate,
      categoryId: expenseFormValues.category,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      recurringExpenseLink: {
        ...(isCreateRecurrence
          ? {
              create: recurringExpenseLinkPayload,
            }
          : {}),
      },
      paidFor: {
        createMany: {
          data: expenseFormValues.paidFor.map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        },
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        createMany: {
          data: expenseFormValues.documents.map((doc) => ({
            id: randomId(),
            url: doc.url,
            width: doc.width,
            height: doc.height,
          })),
        },
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  participantId?: string,
) {
  const existingExpense = await getExpense(groupId, expenseId)
  await logActivity(groupId, ActivityType.DELETE_EXPENSE, {
    participantId,
    expenseId,
    data: existingExpense?.title,
  })

  await prisma.expense.delete({
    where: { id: expenseId },
    include: { paidFor: true, paidBy: true },
  })
}

// Groups are deleted right away by src/lib/group-deletion.ts. Groups scheduled
// for deletion by earlier versions (with a 30 days grace period) can still be
// restored until their deletion date, and are purged by the cron job after it.
export class NotGroupCreatorError extends Error {
  constructor() {
    super('Only the group creator can delete or restore this group')
  }
}

export async function restoreGroup(
  groupId: string,
  lineUserId: string,
  participantId?: string,
) {
  // Once its deletion date has passed, the group may be being purged: it can
  // no longer be restored.
  const { count } = await prisma.group.updateMany({
    where: {
      id: groupId,
      deleteAt: { gt: new Date() },
      creatorLineUserId: lineUserId,
    },
    data: { deleteAt: null },
  })
  if (count === 0) {
    const group = await getGroup(groupId)
    if (group && group.creatorLineUserId !== lineUserId)
      throw new NotGroupCreatorError()
    throw new Error(
      'Group is not scheduled for deletion, or can no longer be restored',
    )
  }

  await logActivity(groupId, ActivityType.RESTORE_GROUP, { participantId })
}

export async function getGroupExpensesParticipants(groupId: string) {
  const [payers, paidFor] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId },
      distinct: ['paidById'],
      select: { paidById: true },
    }),
    prisma.expensePaidFor.findMany({
      where: { expense: { groupId } },
      distinct: ['participantId'],
      select: { participantId: true },
    }),
  ])

  return Array.from(
    new Set([
      ...payers.map((expense) => expense.paidById),
      ...paidFor.map((row) => row.participantId),
    ]),
  )
}

export class ParticipantHasExpensesError extends Error {
  constructor() {
    super('Participants who are part of an expense cannot be removed')
  }
}

/**
 * Removes a participant from a group. Only the group creator can do it, and
 * neither themselves nor a participant who is part of an expense: deleting a
 * participant cascades to the expenses they paid.
 */
export async function removeParticipant(
  groupId: string,
  removedParticipantId: string,
  lineUserId: string,
  participantId?: string,
) {
  const group = await getGroup(groupId)
  if (!group) throw new Error('Invalid group ID')
  if (group.creatorLineUserId !== lineUserId) throw new NotGroupCreatorError()

  const removed = group.participants.find(
    ({ id }) => id === removedParticipantId,
  )
  if (!removed) throw new Error('Participant was not found')
  if (removed.lineUserId === group.creatorLineUserId) {
    throw new Error('The group creator cannot be removed')
  }

  // Checked in the delete itself, so that an expense added concurrently
  // cannot be cascaded away.
  const { count } = await prisma.participant.deleteMany({
    where: {
      id: removedParticipantId,
      groupId,
      expensesPaidBy: { none: {} },
      expensesPaidFor: { none: {} },
    },
  })
  if (count === 0) throw new ParticipantHasExpensesError()

  await logActivity(groupId, ActivityType.UPDATE_GROUP, {
    participantId,
    data: removed.name,
  })
}

/** All groups where the current LINE user is linked to a participant ("my groups" comes from the database). */
export async function getGroupsForLineUser(lineUserId: string) {
  return prisma.group.findMany({
    where: { participants: { some: { lineUserId } } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getGroups(groupIds: string[]) {
  return (
    await prisma.group.findMany({
      where: { id: { in: groupIds } },
      include: { _count: { select: { participants: true } } },
    })
  ).map((group) => ({
    ...group,
    createdAt: group.createdAt.toISOString(),
  }))
}

export async function updateExpense(
  groupId: string,
  expenseId: string,
  expenseFormValues: ExpenseFormValues,
  participantId?: string,
) {
  const group = await getGroup(groupId)
  if (!group) throw new Error(`Invalid group ID: ${groupId}`)

  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  for (const participant of [
    expenseFormValues.paidBy,
    ...expenseFormValues.paidFor.map((p) => p.participant),
  ]) {
    if (!group.participants.some((p) => p.id === participant))
      throw new Error(`Invalid participant ID: ${participant}`)
  }

  await logActivity(groupId, ActivityType.UPDATE_EXPENSE, {
    participantId,
    expenseId,
    data: expenseFormValues.title,
  })

  const isDeleteRecurrenceExpenseLink =
    existingExpense.recurrenceRule !== RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule === RecurrenceRule.NONE &&
    // Delete the existing RecurrenceExpenseLink only if it has not been acted upon yet
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null

  const expenseDateChanged =
    existingExpense.expenseDate.getUTCFullYear() !==
      expenseFormValues.expenseDate.getUTCFullYear() ||
    existingExpense.expenseDate.getUTCMonth() !==
      expenseFormValues.expenseDate.getUTCMonth() ||
    existingExpense.expenseDate.getUTCDate() !==
      expenseFormValues.expenseDate.getUTCDate()
  const isUpdateRecurrenceExpenseLink =
    existingExpense.recurringExpenseLink?.nextExpenseCreatedAt === null &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    (existingExpense.recurrenceRule !== expenseFormValues.recurrenceRule ||
      expenseDateChanged)
  const isCreateRecurrenceExpenseLink =
    existingExpense.recurrenceRule === RecurrenceRule.NONE &&
    expenseFormValues.recurrenceRule !== RecurrenceRule.NONE &&
    // Create a new RecurrenceExpenseLink only if one does not already exist for the expense
    existingExpense.recurringExpenseLink === null

  const newRecurringExpenseLink = createPayloadForNewRecurringExpenseLink(
    expenseFormValues.recurrenceRule as RecurrenceRule,
    expenseFormValues.expenseDate,
    groupId,
  )

  const updatedAnchorDay = usesAnchorDay(expenseFormValues.recurrenceRule)
    ? expenseFormValues.expenseDate.getUTCDate()
    : null
  const updatedRecurrenceExpenseLinkNextExpenseDate = nextRecurringDate(
    expenseFormValues.recurrenceRule,
    expenseFormValues.expenseDate,
    updatedAnchorDay,
  )

  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      expenseDate: expenseFormValues.expenseDate,
      amount: expenseFormValues.amount,
      originalAmount: expenseFormValues.originalAmount,
      originalCurrency: expenseFormValues.originalCurrency,
      conversionRate: expenseFormValues.conversionRate,
      title: expenseFormValues.title,
      categoryId: expenseFormValues.category,
      paidById: expenseFormValues.paidBy,
      splitMode: expenseFormValues.splitMode,
      recurrenceRule: expenseFormValues.recurrenceRule,
      paidFor: {
        create: expenseFormValues.paidFor
          .filter(
            (p) =>
              !existingExpense.paidFor.some(
                (pp) => pp.participantId === p.participant,
              ),
          )
          .map((paidFor) => ({
            participantId: paidFor.participant,
            shares: paidFor.shares,
          })),
        update: expenseFormValues.paidFor.map((paidFor) => ({
          where: {
            expenseId_participantId: {
              expenseId,
              participantId: paidFor.participant,
            },
          },
          data: {
            shares: paidFor.shares,
          },
        })),
        deleteMany: existingExpense.paidFor.filter(
          (paidFor) =>
            !expenseFormValues.paidFor.some(
              (pf) => pf.participant === paidFor.participantId,
            ),
        ),
      },
      recurringExpenseLink: {
        ...(isCreateRecurrenceExpenseLink
          ? {
              create: newRecurringExpenseLink,
            }
          : {}),
        ...(isUpdateRecurrenceExpenseLink
          ? {
              update: {
                nextExpenseDate: updatedRecurrenceExpenseLinkNextExpenseDate,
                anchorDay: updatedAnchorDay,
              },
            }
          : {}),
        delete: isDeleteRecurrenceExpenseLink,
      },
      isReimbursement: expenseFormValues.isReimbursement,
      documents: {
        connectOrCreate: expenseFormValues.documents.map((doc) => ({
          create: doc,
          where: { id: doc.id },
        })),
        deleteMany: existingExpense.documents
          .filter(
            (existingDoc) =>
              !expenseFormValues.documents.some(
                (doc) => doc.id === existingDoc.id,
              ),
          )
          .map((doc) => ({
            id: doc.id,
          })),
      },
      notes: expenseFormValues.notes,
    },
  })
}

export async function updateGroup(
  groupId: string,
  groupFormValues: GroupFormValues,
  participantId?: string,
) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  // Members only join through LINE (see createParticipantForLineUser), and can
  // be neither renamed nor removed, so the participants sent by the form are
  // ignored: deleting one would also cascade to the expenses they paid.
  const updatedGroup = await prisma.group.update({
    where: { id: groupId },
    data: {
      name: groupFormValues.name,
      information: groupFormValues.information,
      currency: groupFormValues.currency,
      currencyCode: groupFormValues.currencyCode,
    },
  })

  await logActivity(groupId, ActivityType.UPDATE_GROUP, { participantId })
  return updatedGroup
}

export async function getGroup(groupId: string) {
  return prisma.group.findUnique({
    where: { id: groupId },
    include: { participants: true },
  })
}

export async function createParticipantForLineUser(
  groupId: string,
  name: string,
  lineUserId: string,
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true },
  })
  if (!group) throw new Error('Invalid group ID')

  const existingBinding = await prisma.participant.findFirst({
    where: { groupId, lineUserId },
    select: { id: true },
  })
  if (existingBinding) {
    throw new Error('This LINE account is already linked in this group')
  }

  return prisma.participant.create({
    data: { id: randomId(), groupId, name, lineUserId },
  })
}

export async function getCategories() {
  return prisma.category.findMany()
}

export async function getGroupExpenses(
  groupId: string,
  options?: { offset?: number; length?: number; filter?: string },
) {
  await createRecurringExpenses()

  return prisma.expense.findMany({
    select: {
      amount: true,
      category: true,
      createdAt: true,
      expenseDate: true,
      id: true,
      isReimbursement: true,
      originalAmount: true,
      originalCurrency: true,
      paidBy: { select: { id: true, name: true } },
      paidFor: {
        select: {
          participant: { select: { id: true, name: true } },
          shares: true,
        },
      },
      splitMode: true,
      recurrenceRule: true,
      title: true,
      _count: { select: { documents: true } },
    },
    where: {
      groupId,
      // Search matches the title or the notes (#601).
      OR: options?.filter
        ? [
            { title: { contains: options.filter, mode: 'insensitive' } },
            { notes: { contains: options.filter, mode: 'insensitive' } },
          ]
        : undefined,
    },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    skip: options && options.offset,
    take: options && options.length,
  })
}

export async function getGroupExpenseCount(groupId: string) {
  return prisma.expense.count({ where: { groupId } })
}

/**
 * Returns the currently active recurring expenses of a group: the latest frame
 * of every ongoing recurring series. Each materialized frame keeps its own
 * `recurringExpenseLink`, but only the current frame's link is still "open"
 * (`nextExpenseCreatedAt` is null) — past frames have it set once their
 * successor is created (see `createRecurringExpenses`). Filtering on the open
 * link ensures a single subscription is counted only once. Used for recurring
 * stats (#508).
 */
export async function getActiveRecurringExpenses(groupId: string) {
  await createRecurringExpenses()

  return prisma.expense.findMany({
    select: {
      id: true,
      title: true,
      amount: true,
      category: true,
      recurrenceRule: true,
      isReimbursement: true,
    },
    where: {
      groupId,
      isReimbursement: false,
      recurrenceRule: { not: RecurrenceRule.NONE },
      recurringExpenseLink: { is: { nextExpenseCreatedAt: null } },
    },
    orderBy: { amount: 'desc' },
  })
}

export async function getExpense(groupId: string, expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: true,
      paidFor: true,
      category: true,
      documents: true,
      recurringExpenseLink: true,
    },
  })
}

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const activities = await prisma.activity.findMany({
    where: { groupId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter(Boolean)
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      id: { in: expenseIds },
    },
  })

  return activities.map((activity) => ({
    ...activity,
    expense:
      activity.expenseId !== null
        ? expenses.find((expense) => expense.id === activity.expenseId)
        : undefined,
  }))
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: { participantId?: string; expenseId?: string; data?: string },
) {
  return prisma.activity.create({
    data: {
      id: randomId(),
      groupId,
      activityType,
      ...extra,
    },
  })
}

async function createRecurringExpenses() {
  const localDate = new Date() // Current local date
  const utcDateFromLocal = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      // More precision beyond date is required to ensure that recurring Expenses are created within <most precises unit> of when expected
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ),
  )

  const recurringExpenseLinksWithExpensesToCreate =
    await prisma.recurringExpenseLink.findMany({
      where: {
        nextExpenseCreatedAt: null,
        nextExpenseDate: {
          lte: utcDateFromLocal,
        },
      },
      include: {
        currentFrameExpense: {
          include: {
            paidBy: true,
            paidFor: true,
            category: true,
            documents: true,
          },
        },
      },
    })

  for (const recurringExpenseLink of recurringExpenseLinksWithExpensesToCreate) {
    let newExpenseDate = recurringExpenseLink.nextExpenseDate

    let currentExpenseRecord = recurringExpenseLink.currentFrameExpense
    let currentReccuringExpenseLinkId = recurringExpenseLink.id
    const anchorDay =
      recurringExpenseLink.anchorDay ??
      (usesAnchorDay(currentExpenseRecord.recurrenceRule)
        ? currentExpenseRecord.expenseDate.getUTCDate()
        : null)

    while (newExpenseDate < utcDateFromLocal) {
      const recurrenceRule = currentExpenseRecord.recurrenceRule

      if (recurrenceRule === null || recurrenceRule === RecurrenceRule.NONE)
        break

      const newExpenseId = randomId()
      const newRecurringExpenseLinkId = randomId()

      const newRecurringExpenseNextExpenseDate = nextRecurringDate(
        recurrenceRule,
        newExpenseDate,
        anchorDay,
      )

      const {
        category,
        paidBy,
        paidFor,
        documents,
        ...destructeredCurrentExpenseRecord
      } = currentExpenseRecord

      // Use a transacton to ensure that the only one expense is created for the RecurringExpenseLink
      // just in case two clients are processing the same RecurringExpenseLink at the same time
      const newExpense = await prisma
        .$transaction(async (transaction) => {
          const newExpense = await transaction.expense.create({
            data: {
              ...destructeredCurrentExpenseRecord,
              categoryId: currentExpenseRecord.categoryId,
              paidById: currentExpenseRecord.paidById,
              paidFor: {
                createMany: {
                  data: currentExpenseRecord.paidFor.map((paidFor) => ({
                    participantId: paidFor.participantId,
                    shares: paidFor.shares,
                  })),
                },
              },
              documents: {
                createMany: {
                  data: currentExpenseRecord.documents.map(
                    (documentRecord) => ({
                      id: randomId(),
                      url: documentRecord.url,
                      width: documentRecord.width,
                      height: documentRecord.height,
                    }),
                  ),
                },
              },
              id: newExpenseId,
              expenseDate: newExpenseDate,
              recurringExpenseLink: {
                create: {
                  groupId: currentExpenseRecord.groupId,
                  id: newRecurringExpenseLinkId,
                  nextExpenseDate: newRecurringExpenseNextExpenseDate,
                  anchorDay,
                },
              },
            },
            // Ensure that the same information is available on the returned record that was created
            include: {
              paidFor: true,
              documents: true,
              category: true,
              paidBy: true,
            },
          })

          // Mark the RecurringExpenseLink as being "completed" since the new Expense was created
          // if an expense hasn't been created for this RecurringExpenseLink yet
          await transaction.recurringExpenseLink.update({
            where: {
              id: currentReccuringExpenseLinkId,
              nextExpenseCreatedAt: null,
            },
            data: {
              nextExpenseCreatedAt: newExpense.createdAt,
              anchorDay,
            },
          })

          return newExpense
        })
        .catch(() => {
          console.error(
            'Failed to created recurringExpense for expenseId: %s',
            currentExpenseRecord.id,
          )
          return null
        })

      // If the new expense failed to be created, break out of the while-loop
      if (newExpense === null) break

      // Set the values for the next iteration of the for-loop in case multiple recurring Expenses need to be created
      currentExpenseRecord = newExpense
      currentReccuringExpenseLinkId = newRecurringExpenseLinkId
      newExpenseDate = newRecurringExpenseNextExpenseDate
    }
  }
}

function createPayloadForNewRecurringExpenseLink(
  recurrenceRule: RecurrenceRule,
  priorDateToNextRecurrence: Date,
  groupId: String,
): RecurringExpenseLink {
  const anchorDay = usesAnchorDay(recurrenceRule)
    ? priorDateToNextRecurrence.getUTCDate()
    : null
  const nextExpenseDate = nextRecurringDate(
    recurrenceRule,
    priorDateToNextRecurrence,
    anchorDay,
  )

  const recurringExpenseLinkId = randomId()
  const recurringExpenseLinkPayload = {
    id: recurringExpenseLinkId,
    groupId: groupId,
    nextExpenseDate: nextExpenseDate,
    anchorDay,
  }

  return recurringExpenseLinkPayload as RecurringExpenseLink
}
