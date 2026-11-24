'use client'

import { GroupForm } from '@/components/group-form'
import { useLiff } from '@/components/liff-provider'
import { useToast } from '@/components/ui/use-toast'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useCurrentGroup } from '../current-group-context'
import { MembersOnly } from '../group-membership'

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
  const { profile } = useLiff()

  if (isLoading) return <></>

  return (
    <MembersOnly description="沒有加入的人可以瀏覽群組，但不能修改群組設定。">
      <GroupForm
        group={data?.group}
        onSubmit={async (groupFormValues, participantId) => {
          try {
            await mutateAsync({
              groupId,
              participantId,
              groupFormValues,
              lineUserId: profile?.userId,
            })
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
    </MembersOnly>
  )
}
