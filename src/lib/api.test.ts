import {
  createGroup,
  NotGroupCreatorError,
  ParticipantHasExpensesError,
  removeParticipant,
  updateGroup,
} from './api'
import { prisma } from './prisma'
import { GroupFormValues } from './schemas'

jest.mock('./prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    activity: { create: jest.fn() },
    participant: { deleteMany: jest.fn() },
    expense: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    group: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  },
}))

let mockIdCount = 0
jest.mock('./random', () => ({
  randomId: () => `random-id-${++mockIdCount}`,
}))

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

  it('links only the creator to LINE, and adds the others by hand', async () => {
    await createGroup(
      formValues([
        { name: 'Alice', lineUserId: 'line-alice' },
        { name: 'Bob', lineUserId: 'line-mallory' },
      ]),
    )

    expect(prisma.group.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorLineUserId: 'line-alice',
          participants: {
            create: [
              expect.objectContaining({
                name: 'Alice',
                lineUserId: 'line-alice',
              }),
              { id: expect.any(String), name: 'Bob' },
            ],
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
  const formValues = (
    participants: GroupFormValues['participants'],
  ): GroupFormValues => ({
    name: 'Renamed trip',
    information: '',
    currency: '$',
    currencyCode: 'USD',
    participants,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(prisma.group.findUnique).mockResolvedValue({
      id: 'group-1',
      creatorLineUserId: 'line-alice',
      participants: [
        { id: 'alice', name: 'Alice', lineUserId: 'line-alice' },
        { id: 'bob', name: 'Bob', lineUserId: null },
        { id: 'carol', name: 'Carol', lineUserId: null },
      ],
    } as any)
    jest
      .mocked(prisma.$transaction)
      .mockImplementation(async (callback: any) => callback(prisma))
  })

  it('adds, renames and removes participants not linked to LINE', async () => {
    jest.mocked(prisma.participant.deleteMany).mockResolvedValue({ count: 1 })

    await updateGroup(
      'group-1',
      formValues([
        { id: 'alice', name: 'Alice', lineUserId: 'line-alice' },
        { id: 'bob', name: 'Robert' },
        { name: 'Dave' },
      ]),
      undefined,
      'line-alice',
    )

    expect(prisma.participant.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['carol'] },
        groupId: 'group-1',
        lineUserId: null,
        expensesPaidBy: { none: {} },
        expensesPaidFor: { none: {} },
      },
    })
    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        name: 'Renamed trip',
        participants: {
          updateMany: [
            {
              where: { id: 'alice', lineUserId: null },
              data: { name: 'Alice' },
            },
            {
              where: { id: 'bob', lineUserId: null },
              data: { name: 'Robert' },
            },
          ],
          createMany: { data: [{ id: expect.any(String), name: 'Dave' }] },
        },
      }),
    })
    expect(prisma.activity.create).toHaveBeenCalled()
  })

  it('leaves alone a participant linked to LINE missing from the form', async () => {
    await updateGroup(
      'group-1',
      formValues([
        { id: 'bob', name: 'Bob' },
        { id: 'carol', name: 'Carol' },
      ]),
      undefined,
      'line-alice',
    )

    expect(prisma.participant.deleteMany).not.toHaveBeenCalled()
    expect(prisma.group.update).toHaveBeenCalled()
  })

  it('ignores the participants when not sent by the creator', async () => {
    await updateGroup(
      'group-1',
      formValues([{ name: 'Mallory' }]),
      undefined,
      'line-bob',
    )

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.participant.deleteMany).not.toHaveBeenCalled()
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

  it('refuses to remove a participant who is part of an expense', async () => {
    jest.mocked(prisma.participant.deleteMany).mockResolvedValue({ count: 0 })

    await expect(
      updateGroup(
        'group-1',
        formValues([
          { id: 'alice', name: 'Alice', lineUserId: 'line-alice' },
          { id: 'bob', name: 'Bob' },
        ]),
        undefined,
        'line-alice',
      ),
    ).rejects.toThrow(ParticipantHasExpensesError)
    expect(prisma.group.update).not.toHaveBeenCalled()
    expect(prisma.activity.create).not.toHaveBeenCalled()
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
