'use client'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { useLiff } from '@/components/liff-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { setActiveUserForGroup } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import { useEffect, useState } from 'react'

export function LineParticipantDialog() {
  const currentGroup = useCurrentGroup()
  const { isReady, profile } = useLiff()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const create = trpc.groups.createLineParticipant.useMutation()

  const group = currentGroup.group
  const groupId = currentGroup.groupId
  const isPending = create.isPending

  useEffect(() => {
    if (!isReady || !profile || !group) return

    const participant = group.participants.find(
      ({ lineUserId }) => lineUserId === profile.userId,
    )
    if (participant) {
      setActiveUserForGroup(groupId, participant.id)
      setOpen(false)
      return
    }

    setOpen(true)
  }, [group, groupId, isReady, profile])

  if (!isReady || !profile || !group) return null

  const finish = (participantId: string) => {
    setActiveUserForGroup(groupId, participantId)
    setOpen(false)
    void utils.groups.get.invalidate({ groupId })
  }

  const showError = (error: unknown) => {
    toast({
      description:
        error instanceof Error ? error.message : '無法加入群組，請稍後再試。',
      variant: 'destructive',
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>加入這個群組</DialogTitle>
          <DialogDescription>
            你好，{profile.displayName}。成員只能透過 LINE 加入，加入後會以你的
            LINE 名稱顯示。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            disabled={isPending}
            onClick={async () => {
              try {
                const participant = await create.mutateAsync({
                  groupId,
                  name: profile.displayName,
                  lineUserId: profile.userId,
                })
                finish(participant.id)
              } catch (error) {
                showError(error)
              }
            }}
          >
            以「{profile.displayName}」加入
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
