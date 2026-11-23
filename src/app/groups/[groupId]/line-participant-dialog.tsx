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
  const claim = trpc.groups.claimLineParticipant.useMutation()
  const create = trpc.groups.createLineParticipant.useMutation()

  const group = currentGroup.group
  const groupId = currentGroup.groupId
  const isPending = claim.isPending || create.isPending

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
        error instanceof Error ? error.message : '無法綁定 LINE 身分，請稍後再試。',
      variant: 'destructive',
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>選擇你在這個群組中的身分</DialogTitle>
          <DialogDescription>
            你好，{profile.displayName}。你可以認領尚未綁定 LINE 的成員，或建立新成員。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {group.participants
            .filter(({ lineUserId }) => !lineUserId)
            .map((participant) => (
              <Button
                key={participant.id}
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={async () => {
                  try {
                    const claimed = await claim.mutateAsync({
                      groupId,
                      participantId: participant.id,
                      lineUserId: profile.userId,
                    })
                    finish(claimed.id)
                  } catch (error) {
                    showError(error)
                  }
                }}
              >
                認領「{participant.name}」
              </Button>
            ))}

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
            以「{profile.displayName}」建立新成員
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
