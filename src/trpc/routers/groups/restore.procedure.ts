import { NotGroupCreatorError, restoreGroup } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const restoreGroupProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      lineUserId: z.string().min(1),
      participantId: z.string().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, lineUserId, participantId } }) => {
    try {
      await restoreGroup(groupId, lineUserId, participantId)
    } catch (error) {
      if (error instanceof NotGroupCreatorError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
      }
      throw error
    }
  })
