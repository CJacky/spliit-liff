import { NotGroupCreatorError } from '@/lib/api'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import { deleteGroup } from '@/lib/group-deletion'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const deleteGroupProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      groupName: z.string().min(1),
      lineUserId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId, groupName, lineUserId } }) => {
    // Restoring stays available while the feature is disabled, so that groups
    // scheduled before it was turned off can still be saved.
    const { enableGroupDeletion } = await getRuntimeFeatureFlags()
    if (!enableGroupDeletion) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Group deletion is not enabled on this instance.',
      })
    }
    try {
      await deleteGroup(groupId, groupName, lineUserId)
    } catch (error) {
      if (error instanceof NotGroupCreatorError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message })
      }
      throw error
    }
  })
