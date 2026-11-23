import { getGroupsForLineUser } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const listMyGroupsProcedure = baseProcedure
  .input(z.object({ lineUserId: z.string().min(1).max(255) }))
  .query(async ({ input: { lineUserId } }) => {
    const groups = await getGroupsForLineUser(lineUserId)
    return { groups }
  })
