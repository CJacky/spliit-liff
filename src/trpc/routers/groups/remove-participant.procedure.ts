import {
  NotGroupCreatorError,
  ParticipantHasExpensesError,
  removeParticipant,
} from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const removeParticipantProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      removedParticipantId: z.string().min(1).max(64),
      lineUserId: z.string().min(1).max(255),
      participantId: z.string().optional(),
    }),
  )
  .mutation(async ({ input }) => {
    try {
      await removeParticipant(
        input.groupId,
        input.removedParticipantId,
        input.lineUserId,
        input.participantId,
      )
    } catch (error) {
      if (
        error instanceof NotGroupCreatorError ||
        error instanceof ParticipantHasExpensesError
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
      }
      throw error
    }
  })
