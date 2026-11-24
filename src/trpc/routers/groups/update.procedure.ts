import { updateGroup } from '@/lib/api'
import { groupFormSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const updateGroupProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      groupFormValues: groupFormSchema,
      participantId: z.string().optional(),
      /** Only the group creator can manage participants by hand. */
      lineUserId: z.string().min(1).max(255).optional(),
    }),
  )
  .mutation(
    async ({
      input: { groupId, groupFormValues, participantId, lineUserId },
    }) => {
      await updateGroup(groupId, groupFormValues, participantId, lineUserId)
    },
  )
