import { ActivityType, Expense } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import { ExpenseFormValues, GroupFormValues } from '@/lib/schemas'

// Re-exported for backwards compatibility with existing server-side importers.
export { randomId }

export async function createGroup(groupFormValues: GroupFormValues) {
  // The creator is the first participant, linked to their LINE account. The
  // others are added by hand (temporarily allowed again) and are not linked:
  // LINE accounts only get linked through createParticipantForLineUser.
  const [creator, ...others] = groupFormValues.participants
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
        create: [
          {
            id: randomId(),
            name: creator.name,
            lineUserId: creator.lineUserId,
          },
          ...others.map(({ name }) => ({ id: randomId(), name })),
        ],
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
  lineUserId?: string,
) {
  const existingGroup = await getGroup(groupId)
  if (!existingGroup) throw new Error('Invalid group ID')

  const groupData = {
    name: groupFormValues.name,
    information: groupFormValues.information,
    currency: groupFormValues.currency,
    currencyCode: groupFormValues.currencyCode,
  }

  // Only the group creator can add, rename and remove participants by hand
  // (temporarily allowed again); for anyone else the participants sent by the
  // form are ignored.
  const isCreator =
    !!lineUserId && existingGroup.creatorLineUserId === lineUserId
  if (!isCreator) {
    const updatedGroup = await prisma.group.update({
      where: { id: groupId },
      data: groupData,
    })
    await logActivity(groupId, ActivityType.UPDATE_GROUP, { participantId })
    return updatedGroup
  }

  // Only participants not linked to LINE are managed by hand. Those linked to
  // LINE keep the name of their LINE account, and are only removed through
  // removeParticipant: one missing from the form has probably just joined.
  const removedParticipants = existingGroup.participants.filter(
    (p) =>
      !p.lineUserId &&
      !groupFormValues.participants.some((p2) => p2.id === p.id),
  )

  const updatedGroup = await prisma.$transaction(async (tx) => {
    if (removedParticipants.length > 0) {
      // Checked in the delete itself, so that an expense added concurrently
      // cannot be cascaded away.
      const { count } = await tx.participant.deleteMany({
        where: {
          id: { in: removedParticipants.map(({ id }) => id) },
          groupId,
          lineUserId: null,
          expensesPaidBy: { none: {} },
          expensesPaidFor: { none: {} },
        },
      })
      if (count !== removedParticipants.length) {
        throw new ParticipantHasExpensesError()
      }
    }

    return tx.group.update({
      where: { id: groupId },
      data: {
        ...groupData,
        participants: {
          updateMany: groupFormValues.participants
            .filter((participant) => participant.id !== undefined)
            .map((participant) => ({
              where: { id: participant.id, lineUserId: null },
              data: { name: participant.name },
            })),
          createMany: {
            data: groupFormValues.participants
              .filter((participant) => participant.id === undefined)
              .map((participant) => ({
                id: randomId(),
                name: participant.name,
              })),
          },
        },
      },
    })
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

export async function getExpense(groupId: string, expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: true,
      paidFor: true,
      category: true,
      documents: true,
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
