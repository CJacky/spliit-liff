import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/components/ui/use-toast'
import { Participant } from '@/generated/prisma/browser'
import { Reimbursement } from '@/lib/balances'
import { Currency } from '@/lib/currency'
import { useActiveUser } from '@/lib/hooks'
import { formatCurrency } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useGroupMembership } from './group-membership'

type Props = {
  reimbursements: Reimbursement[]
  participants: Participant[]
  currency: Currency
  groupId: string
}

export function ReimbursementList({
  reimbursements,
  participants,
  currency,
  groupId,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('Balances.Reimbursements')
  if (reimbursements.length === 0) {
    return <p className="text-sm pb-6">{t('noImbursements')}</p>
  }

  const getParticipant = (id: string) => participants.find((p) => p.id === id)
  return (
    <div className="text-sm">
      {reimbursements.map((reimbursement) => {
        const from = getParticipant(reimbursement.from)?.name ?? ''
        const to = getParticipant(reimbursement.to)?.name ?? ''
        return (
          <div
            className="py-4 flex justify-between"
            key={`${reimbursement.from}-${reimbursement.to}`}
            data-testid="reimbursement-row"
            data-from={from}
            data-to={to}
          >
            <div className="flex flex-col gap-1 items-start sm:flex-row sm:items-baseline sm:gap-4">
              <div>
                {t.rich('owes', {
                  from,
                  to,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </div>
              <MarkAsPaidButton
                groupId={groupId}
                reimbursement={reimbursement}
                fromName={from}
                toName={to}
                formattedAmount={formatCurrency(
                  currency,
                  reimbursement.amount,
                  locale,
                )}
              />
            </div>
            <div>{formatCurrency(currency, reimbursement.amount, locale)}</div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Records the suggested reimbursement as a repayment right away, after a
 * confirmation. The repayment is created in the group currency; to record a
 * transfer made in another currency, edit the created expense afterwards.
 */
function MarkAsPaidButton({
  groupId,
  reimbursement,
  fromName,
  toName,
  formattedAmount,
}: {
  groupId: string
  reimbursement: Reimbursement
  fromName: string
  toName: string
  formattedAmount: string
}) {
  const t = useTranslations('Balances.Reimbursements')
  const tExpense = useTranslations('ExpenseForm')
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const activeUserId = useActiveUser(groupId)
  const { guardClick } = useGroupMembership()
  const { mutateAsync } = trpc.groups.expenses.create.useMutation()
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const markAsPaid = async () => {
    setIsSaving(true)
    try {
      await mutateAsync({
        groupId,
        participantId:
          activeUserId && activeUserId !== 'None' ? activeUserId : undefined,
        expenseFormValues: {
          title: tExpense('reimbursement'),
          expenseDate: getToday(),
          category: 1, // category with Id 1 is Payment
          // Already in minor units, as stored.
          amount: reimbursement.amount,
          originalCurrency: null,
          paidBy: reimbursement.from,
          paidFor: [{ participant: reimbursement.to, shares: 1 }],
          splitMode: 'EVENLY',
          saveDefaultSplittingOptions: false,
          isReimbursement: true,
          documents: [],
          notes: '',
        },
      })
      setOpen(false)
    } catch {
      toast({ description: t('markAsPaidError'), variant: 'destructive' })
    } finally {
      setIsSaving(false)
      await Promise.all([
        utils.groups.balances.invalidate(),
        utils.groups.expenses.invalidate(),
        utils.groups.stats.invalidate(),
      ])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          className="-mx-4 -my-3"
          type="button"
          onClick={guardClick}
        >
          {t('markAsPaid')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-3">
        <p className="text-sm">
          {t.rich('confirmMarkAsPaid', {
            from: fromName,
            to: toName,
            amount: formattedAmount,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        <Button type="button" onClick={markAsPaid} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t('confirm')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** Today at UTC midnight, the way the expense form stores expense dates. */
function getToday() {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}
