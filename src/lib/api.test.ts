import {
  createGroup,
  getGroupExpenses,
  NotGroupCreatorError,
  ParticipantHasExpensesError,
  removeParticipant,
  updateExpense,
  updateGroup,
} from './api'
import { prisma } from './prisma'
import { ExpenseFormValues, GroupFormValues } from './schemas'

jest.mock('./prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    activity: { create: jest.fn() },
    participant: { deleteMany: jest.fn() },
    expense: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    group: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    recurringExpenseLink: { findMany: jest.fn() },
  },
}))

let mockIdCount = 0
jest.mock('./random', () => ({
  randomId: () => `random-id-${++mockIdCount}`,
}))

describe('getGroupExpenses', () => {
  it('copies the documents of a recurring expense to the next occurrence instead of moving them', async () => {
    const document = {
      id: 'document-1',
      url: 'https://example.com/receipt.jpg',
      width: 800,
      height: 600,
      expenseId: 'expense-1',
    }
    const currentFrameExpense = {
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Rent',
      amount: 1000,
      categoryId: 0,
      paidById: 'participant-1',
      recurrenceRule: 'DAILY',
      createdAt: new Date(),
      category: null,
      paidBy: { id: 'participant-1' },
      paidFor: [
        { expenseId: 'expense-1', participantId: 'participant-1', shares: 1 },
      ],
      documents: [document],
    }

    const createExpense = jest.fn(async ({ data }) => ({
      ...currentFrameExpense,
      id: data.id,
      createdAt: new Date(),
    }))
    const transaction = {
      expense: { create: createExpense },
      recurringExpenseLink: { update: jest.fn() },
    }

    jest.mocked(prisma.recurringExpenseLink.findMany).mockResolvedValue([
      {
        id: 'link-1',
        groupId: 'group-1',
        currentFrameExpenseId: 'expense-1',
        // An hour ago, so exactly one daily occurrence is due.
        nextExpenseDate: new Date(Date.now() - 60 * 60 * 1000),
        nextExpenseCreatedAt: null,
        currentFrameExpense,
      },
    ] as never)
    jest
      .mocked(prisma.$transaction)
      .mockImplementation((async (callback: (tx: unknown) => unknown) =>
        callback(transaction)) as never)
    jest.mocked(prisma.expense.findMany).mockResolvedValue([])

    await getGroupExpenses('group-1')

    expect(createExpense).toHaveBeenCalledTimes(1)
    const { documents } = createExpense.mock.calls[0][0].data
    expect(documents).toEqual({
      createMany: {
        data: [
          {
            id: expect.any(String),
            url: document.url,
            width: document.width,
            height: document.height,
          },
        ],
      },
    })
    // Reusing the id would point the existing document at the new expense
    // and take it away from the expense it was uploaded for.
    expect(documents.createMany.data[0].id).not.toBe(document.id)
  })
})

describe('createRecurringExpenses', () => {
  const day = (date: Date) => date.toISOString().slice(0, 10)

  function setUp({
    recurrenceRule,
    expenseDate,
    nextExpenseDate,
    anchorDay,
  }: {
    recurrenceRule: string | null
    expenseDate: Date
    nextExpenseDate: Date
    anchorDay: number | null
  }) {
    const currentFrameExpense = {
      id: 'expense-1',
      groupId: 'group-1',
      title: 'Rent',
      amount: 1000,
      categoryId: 0,
      paidById: 'participant-1',
      recurrenceRule,
      expenseDate,
      createdAt: new Date(),
      category: null,
      paidBy: { id: 'participant-1' },
      paidFor: [],
      documents: [],
    }
    const createExpense = jest.fn(async ({ data }) => ({
      ...currentFrameExpense,
      id: data.id,
      expenseDate: data.expenseDate,
      createdAt: new Date(),
    }))
    const updateLink = jest.fn()
    const transaction = {
      expense: { create: createExpense },
      recurringExpenseLink: { update: updateLink },
    }
    jest.mocked(prisma.recurringExpenseLink.findMany).mockResolvedValue([
      {
        id: 'link-1',
        groupId: 'group-1',
        currentFrameExpenseId: 'expense-1',
        nextExpenseDate,
        nextExpenseCreatedAt: null,
        anchorDay,
        currentFrameExpense,
      },
    ] as never)
    jest
      .mocked(prisma.$transaction)
      .mockImplementation((async (callback: (tx: unknown) => unknown) =>
        callback(transaction)) as never)
    jest.mocked(prisma.expense.findMany).mockResolvedValue([])
    return { createExpense, updateLink }
  }

  beforeEach(() => jest.clearAllMocks())

  it.each([null, 'NONE'])(
    'creates nothing and returns when the rule is %p',
    async (recurrenceRule) => {
      const { createExpense } = setUp({
        recurrenceRule,
        expenseDate: new Date(Date.UTC(2025, 0, 31)),
        nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
        anchorDay: null,
      })

      await getGroupExpenses('group-1')

      expect(createExpense).not.toHaveBeenCalled()
    },
  )

  it('keeps the stored anchor day across a short month', async () => {
    const { createExpense } = setUp({
      recurrenceRule: 'MONTHLY',
      expenseDate: new Date(Date.UTC(2025, 0, 31)),
      nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
      anchorDay: 31,
    })

    await getGroupExpenses('group-1')

    const created = createExpense.mock.calls.map(([{ data }]) => data)
    expect(day(created[0].expenseDate)).toBe('2025-02-28')
    expect(day(created[1].expenseDate)).toBe('2025-03-31')
    expect(created[0].recurringExpenseLink.create.anchorDay).toBe(31)
  })

  it('derives the anchor day of a link created before the column existed', async () => {
    const { createExpense, updateLink } = setUp({
      recurrenceRule: 'MONTHLY',
      expenseDate: new Date(Date.UTC(2025, 0, 31)),
      nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
      anchorDay: null,
    })

    await getGroupExpenses('group-1')

    const created = createExpense.mock.calls.map(([{ data }]) => data)
    expect(day(created[1].expenseDate)).toBe('2025-03-31')
    expect(created[0].recurringExpenseLink.create.anchorDay).toBe(31)
    expect(updateLink.mock.calls[0][0].data.anchorDay).toBe(31)
  })

  it('repeats a yearly expense on 29 February in common years', async () => {
    const { createExpense } = setUp({
      recurrenceRule: 'YEARLY',
      expenseDate: new Date(Date.UTC(2024, 1, 29)),
      nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
      anchorDay: null,
    })

    await getGroupExpenses('group-1')

    const created = createExpense.mock.calls.map(([{ data }]) => data)
    expect(day(created[0].expenseDate)).toBe('2025-02-28')
    expect(day(created[1].expenseDate)).toBe('2026-02-28')
    expect(created[0].recurringExpenseLink.create.anchorDay).toBe(29)
  })
})

describe('updateExpense', () => {
  const existingExpense = {
    id: 'expense-1',
    groupId: 'group-1',
    title: 'Rent',
    expenseDate: new Date(Date.UTC(2025, 0, 15)),
    recurrenceRule: 'MONTHLY',
    paidFor: [{ expenseId: 'expense-1', participantId: 'participant-1' }],
    documents: [],
    recurringExpenseLink: {
      id: 'link-1',
      nextExpenseCreatedAt: null,
      nextExpenseDate: new Date(Date.UTC(2025, 1, 15)),
      anchorDay: 15,
    },
  }

  const formValues = (
    overrides: Partial<ExpenseFormValues>,
  ): ExpenseFormValues =>
    ({
      expenseDate: existingExpense.expenseDate,
      title: 'Rent',
      category: 0,
      amount: 1000,
      paidBy: 'participant-1',
      paidFor: [{ participant: 'participant-1', shares: 1 }],
      splitMode: 'EVENLY',
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'MONTHLY',
      ...overrides,
    }) as ExpenseFormValues

  async function linkUpdate(values: ExpenseFormValues) {
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      participants: [{ id: 'participant-1' }],
    } as never)
    jest
      .mocked(prisma.expense.findUnique)
      .mockResolvedValue(existingExpense as never)
    await updateExpense('group-1', 'expense-1', values)
    return jest.mocked(prisma.expense.update).mock.calls[0][0].data
      .recurringExpenseLink
  }

  beforeEach(() => jest.clearAllMocks())

  it('reschedules the next occurrence from the new expense date', async () => {
    const link = await linkUpdate(
      formValues({ expenseDate: new Date(Date.UTC(2025, 0, 31)) }),
    )

    expect(link).toEqual({
      update: {
        nextExpenseDate: new Date(Date.UTC(2025, 1, 28)),
        anchorDay: 31,
      },
      delete: false,
    })
  })

  it('leaves the link alone when neither the date nor the rule changes', async () => {
    const link = await linkUpdate(formValues({ title: 'New rent' }))

    expect(link).toEqual({ delete: false })
  })

  it('only deletes the link when the rule is switched to NONE', async () => {
    const link = await linkUpdate(
      formValues({
        recurrenceRule: 'NONE',
        expenseDate: new Date(Date.UTC(2025, 0, 31)),
      }),
    )

    expect(link).toEqual({ delete: true })
  })

  it('schedules the next occurrence a year later when switching to yearly', async () => {
    const link = await linkUpdate(formValues({ recurrenceRule: 'YEARLY' }))

    expect(link?.update).toEqual({
      nextExpenseDate: new Date(Date.UTC(2026, 0, 15)),
      anchorDay: 15,
    })
  })

  it('clears the anchor day when switching to weekly', async () => {
    const link = await linkUpdate(formValues({ recurrenceRule: 'WEEKLY' }))

    expect(link?.update).toEqual({
      nextExpenseDate: new Date(Date.UTC(2025, 0, 22)),
      anchorDay: null,
    })
  })
})

describe('createGroup', () => {
  const formValues = (
    participants: GroupFormValues['participants'],
  ): GroupFormValues => ({
    name: 'Trip',
    information: '',
    currency: '$',
    currencyCode: 'USD',
    participants,
  })

  beforeEach(() => jest.clearAllMocks())

  it('only creates the creator, linked to their LINE account', async () => {
    await createGroup(
      formValues([
        { name: 'Alice', lineUserId: 'line-alice' },
        { name: 'Bob' },
      ]),
    )

    expect(prisma.group.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorLineUserId: 'line-alice',
          participants: {
            create: expect.objectContaining({
              name: 'Alice',
              lineUserId: 'line-alice',
            }),
          },
        }),
      }),
    )
  })

  it('refuses a creator who is not linked to LINE', async () => {
    await expect(createGroup(formValues([{ name: 'Alice' }]))).rejects.toThrow(
      /LINE/,
    )
    expect(prisma.group.create).not.toHaveBeenCalled()
  })
})

describe('updateGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      participants: [{ id: 'alice', name: 'Alice', lineUserId: 'line-alice' }],
    } as any)
  })

  it('ignores the participants, which only join through LINE', async () => {
    await updateGroup('group-1', {
      name: 'Renamed trip',
      information: '',
      currency: '$',
      currencyCode: 'USD',
      // Alice removed, Mallory added: neither must reach the database.
      participants: [{ name: 'Mallory' }],
    })

    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: {
        name: 'Renamed trip',
        information: '',
        currency: '$',
        currencyCode: 'USD',
      },
    })
    expect(prisma.activity.create).toHaveBeenCalled()
  })
})

describe('removeParticipant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      creatorLineUserId: 'line-alice',
      participants: [
        { id: 'alice', name: 'Alice', lineUserId: 'line-alice' },
        { id: 'bob', name: 'Bob', lineUserId: 'line-bob' },
      ],
    } as any)
    jest.mocked(prisma.participant.deleteMany).mockResolvedValue({ count: 1 })
  })

  it('lets the creator remove a participant without expenses', async () => {
    await removeParticipant('group-1', 'bob', 'line-alice', 'alice')

    expect(prisma.participant.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'bob',
        groupId: 'group-1',
        expensesPaidBy: { none: {} },
        expensesPaidFor: { none: {} },
      },
    })
    expect(prisma.activity.create).toHaveBeenCalled()
  })

  it('refuses anyone but the creator', async () => {
    await expect(
      removeParticipant('group-1', 'alice', 'line-bob'),
    ).rejects.toThrow(NotGroupCreatorError)
    expect(prisma.participant.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses to remove the creator', async () => {
    await expect(
      removeParticipant('group-1', 'alice', 'line-alice'),
    ).rejects.toThrow(/creator/)
    expect(prisma.participant.deleteMany).not.toHaveBeenCalled()
  })

  it('refuses a participant who is part of an expense', async () => {
    jest.mocked(prisma.participant.deleteMany).mockResolvedValue({ count: 0 })

    await expect(
      removeParticipant('group-1', 'bob', 'line-alice'),
    ).rejects.toThrow(ParticipantHasExpensesError)
    expect(prisma.activity.create).not.toHaveBeenCalled()
  })

  it('refuses a participant of another group', async () => {
    await expect(
      removeParticipant('group-1', 'mallory', 'line-alice'),
    ).rejects.toThrow(/not found/)
    expect(prisma.participant.deleteMany).not.toHaveBeenCalled()
  })
})
