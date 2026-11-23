import { createParticipantForLineUser } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const createLineParticipantProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      name: z.string().min(1).max(50),
      lineUserId: z.string().min(1).max(255),
    }),
  )
  .mutation(async ({ input }) =>
    createParticipantForLineUser(input.groupId, input.name, input.lineUserId),
  )
