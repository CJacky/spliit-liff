import { claimParticipantForLineUser } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const claimLineParticipantProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1).max(64),
      participantId: z.string().min(1).max(64),
      lineUserId: z.string().min(1).max(255),
    }),
  )
  .mutation(async ({ input }) =>
    claimParticipantForLineUser(
      input.groupId,
      input.participantId,
      input.lineUserId,
    ),
  )
