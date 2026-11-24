'use client'

import { useLiff } from '@/components/liff-provider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  createContext,
  MouseEvent,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useCurrentGroup } from './current-group-context'

type GroupMembership = {
  /** Whether the current LINE account is linked to a participant of the group. */
  isMember: boolean
  /** Whether the join dialog (LineParticipantDialog) is open. */
  isJoinDialogOpen: boolean
  setJoinDialogOpen: (open: boolean) => void
}

const GroupMembershipContext = createContext<GroupMembership | null>(null)

/**
 * Anyone with the link can browse a group, but only its members can record or
 * change anything in it: the others are asked to join first.
 *
 * This only guides the UI. The server trusts the LINE user id sent by the
 * client, so it does not enforce membership.
 */
export function GroupMembershipProvider({ children }: PropsWithChildren) {
  const { group } = useCurrentGroup()
  const { profile } = useLiff()
  const [isJoinDialogOpen, setJoinDialogOpen] = useState(false)

  const isMember =
    !!profile &&
    !!group?.participants.some(
      ({ lineUserId }) => lineUserId === profile.userId,
    )

  const value = useMemo(
    () => ({ isMember, isJoinDialogOpen, setJoinDialogOpen }),
    [isMember, isJoinDialogOpen],
  )

  return (
    <GroupMembershipContext.Provider value={value}>
      {children}
    </GroupMembershipContext.Provider>
  )
}

export function useGroupMembership() {
  const context = useContext(GroupMembershipContext)
  if (!context) {
    throw new Error(
      'Missing context. Should be called inside a GroupMembershipProvider.',
    )
  }

  const { isMember, setJoinDialogOpen } = context
  const requestJoin = useCallback(
    () => setJoinDialogOpen(true),
    [setJoinDialogOpen],
  )

  /**
   * Click handler for links and buttons that lead to recording something:
   * for a non-member, it opens the join dialog instead.
   */
  const guardClick = useCallback(
    (event: MouseEvent) => {
      if (isMember) return
      event.preventDefault()
      event.stopPropagation()
      requestJoin()
    },
    [isMember, requestJoin],
  )

  return { ...context, requestJoin, guardClick }
}

/** Asks a non-member to join the group, in place of a members-only page. */
export function JoinGroupCard({ description }: { description: string }) {
  const { requestJoin } = useGroupMembership()

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>加入群組後才能使用</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={requestJoin}>
          加入這個群組
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Renders its children for members only; non-members get a JoinGroupCard.
 * Renders nothing while the group is loading, to avoid a flash of the card.
 */
export function MembersOnly({
  description,
  children,
}: PropsWithChildren<{ description: string }>) {
  const { isLoading } = useCurrentGroup()
  const { isMember } = useGroupMembership()

  if (isLoading) return null
  if (!isMember) return <JoinGroupCard description={description} />
  return <>{children}</>
}
