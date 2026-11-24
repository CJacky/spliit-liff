'use client'

import { useLiff } from '@/components/liff-provider'
import { Button } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/components/ui/use-toast'
import { useActiveUser } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'

type Props = {
  groupId: string
  participant: { id: string; name: string }
  /** Participants who are part of an expense cannot be removed. */
  hasExpenses: boolean
  /** Called once the participant has been removed. */
  onRemoved?: (participantId: string) => void
}

/** Lets the group creator remove a participant, right away. */
export function RemoveParticipantButton({
  groupId,
  participant,
  hasExpenses,
  onRemoved,
}: Props) {
  const { mutateAsync } = trpc.groups.removeParticipant.useMutation()
  const utils = trpc.useUtils()
  const { toast } = useToast()
  const { profile } = useLiff()
  const activeUserId = useActiveUser(groupId)
  const [open, setOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  if (hasExpenses) {
    return (
      <HoverCard>
        <HoverCardTrigger>
          <Button variant="ghost" type="button" size="icon" disabled>
            <Trash2 className="w-4 h-4 text-destructive opacity-50" />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent align="end" className="text-sm">
          此成員已有消費紀錄，無法移除。
        </HoverCardContent>
      </HoverCard>
    )
  }

  const remove = async () => {
    if (!profile) return
    setIsRemoving(true)
    try {
      await mutateAsync({
        groupId,
        removedParticipantId: participant.id,
        lineUserId: profile.userId,
        participantId: activeUserId ?? undefined,
      })
      setOpen(false)
      onRemoved?.(participant.id)
    } catch {
      toast({
        description: `無法移除「${participant.name}」：可能剛新增了他的消費紀錄，請重新整理頁面後再試。`,
        variant: 'destructive',
      })
    } finally {
      setIsRemoving(false)
      await utils.groups.invalidate()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="text-destructive"
          type="button"
          size="icon"
          title={`移除「${participant.name}」`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <p className="text-sm">
          確定要將「{participant.name}」移出群組嗎？他之後仍可透過 LINE
          重新加入。
        </p>
        <Button
          type="button"
          variant="destructive"
          onClick={remove}
          disabled={isRemoving}
        >
          {isRemoving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          移除成員
        </Button>
      </PopoverContent>
    </Popover>
  )
}
