'use client'

import { GroupForm } from '@/components/group-form'
import { useToast } from '@/components/ui/use-toast'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useCurrentGroup } from '../current-group-context'

export const EditGroup = ({
  runtimeFeatureFlags,
}: {
  runtimeFeatureFlags: RuntimeFeatureFlags
}) => {
  const { groupId } = useCurrentGroup()
  const { data, isLoading } = trpc.groups.getDetails.useQuery({ groupId })
  const { mutateAsync } = trpc.groups.update.useMutation()
  const utils = trpc.useUtils()
  const { toast } = useToast()

  if (isLoading) return <></>

  return (
    <GroupForm
      group={data?.group}
      onSubmit={async (groupFormValues, participantId) => {
        try {
          await mutateAsync({ groupId, participantId, groupFormValues })
        } catch {
          toast({
            description: '無法儲存群組，請重新整理頁面後再試。',
            variant: 'destructive',
          })
          return
        }
        await utils.groups.invalidate()
      }}
      protectedParticipantIds={data?.participantsWithExpenses}
      enableGroupDeletion={runtimeFeatureFlags.enableGroupDeletion}
    />
  )
}
