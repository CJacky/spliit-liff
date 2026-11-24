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
import { useEffect, useRef } from 'react'
import { useGroupMembership } from './group-membership'

export function LineParticipantDialog() {
  const currentGroup = useCurrentGroup()
  const { isReady, profile } = useLiff()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  // Shared, so that members-only actions can open it too (see group-membership).
  const { isJoinDialogOpen: open, setJoinDialogOpen: setOpen } =
    useGroupMembership()
  const create = trpc.groups.createLineParticipant.useMutation()

  const group = currentGroup.group
  const groupId = currentGroup.groupId
  const isPending = create.isPending
  // Non-members may browse the group: offer to join once per visit, rather
  // than every time the group is refetched.
  const hasOfferedToJoin = useRef(false)

  useEffect(() => {
    if (!isReady || !profile || !group) return

    const participant = group.participants.find(
      ({ lineUserId }) => lineUserId === profile.userId,
    )
    if (participant) {
      // Default to the LINE-linked participant. Only the group creator can
      // pick another one by hand in the group settings (temporarily allowed
      // again), which is kept.
      const storedActiveUserId = localStorage.getItem(`${groupId}-activeUser`)
      const keepStored =
        group.creatorLineUserId === profile.userId &&
        group.participants.some(({ id }) => id === storedActiveUserId)
      if (!keepStored) setActiveUserForGroup(groupId, participant.id)
      setOpen(false)
      return
    }

    if (hasOfferedToJoin.current) return
    hasOfferedToJoin.current = true
    setOpen(true)
  }, [group, groupId, isReady, profile, setOpen])

  if (!isReady || !profile || !group) return null

  const finish = (participantId: string) => {
    setActiveUserForGroup(groupId, participantId)
    setOpen(false)
    // Also refreshes the group details used by the group settings.
    void utils.groups.invalidate()
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
            你好，{profile.displayName}
            。不加入也可以瀏覽，但加入後才能記帳。加入後會以你的 LINE 名稱顯示。
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
