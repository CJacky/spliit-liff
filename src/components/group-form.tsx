import { DeleteGroupButton } from '@/components/delete-group-button'
import { useLiff } from '@/components/liff-provider'
import { RemoveParticipantButton } from '@/components/remove-participant-button'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Locale } from '@/i18n/request'
import { useAnalytics } from '@/lib/analytics/context'
import { getGroup } from '@/lib/api'
import { defaultCurrencyList, getCurrency } from '@/lib/currency'
import { setActiveUserForGroup } from '@/lib/hooks'
import {
  GROUP_INFORMATION_MAX,
  groupFormSchema,
  GroupFormValues,
} from '@/lib/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useFieldArray, useForm } from 'react-hook-form'
import { CurrencySelector } from './currency-selector'
import { Textarea } from './ui/textarea'

export type Props = {
  group?: NonNullable<Awaited<ReturnType<typeof getGroup>>>
  onSubmit: (
    groupFormValues: GroupFormValues,
    participantId?: string,
  ) => Promise<void>
  /** Participants who are part of an expense, and so cannot be removed. */
  protectedParticipantIds?: string[]
  /** Resolved on the server, since the runtime variable is not public. */
  defaultCurrencyCode?: string
  /** Whether to offer deleting the group (ENABLE_GROUP_DELETION). */
  enableGroupDeletion?: boolean
}

export function GroupForm({
  group,
  onSubmit,
  protectedParticipantIds = [],
  defaultCurrencyCode = 'USD',
  enableGroupDeletion = false,
}: Props) {
  const locale = useLocale()
  const t = useTranslations('GroupForm')
  const { profile } = useLiff()
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: group
      ? {
          name: group.name,
          information: group.information ?? '',
          currency: group.currency ?? '',
          currencyCode: group.currencyCode ?? '',
          participants: group.participants,
        }
      : {
          name: '',
          information: '',
          currency: '',
          currencyCode: defaultCurrencyCode, // TODO: derive from the locale when not configured
          // The creator is always the first participant, linked to the current LINE account.
          participants: [
            {
              name: profile?.displayName ?? '',
              lineUserId: profile?.userId,
            },
          ],
        },
  })
  const { fields } = useFieldArray({
    control: form.control,
    name: 'participants',
    keyName: 'key',
  })
  const sendEvent = useAnalytics()

  // The current user is always the participant linked to the current LINE
  // account (see LineParticipantDialog); it cannot be changed here.
  const lineParticipant = profile
    ? group?.participants.find(
        ({ lineUserId }) => lineUserId === profile.userId,
      )
    : undefined

  const isCreator =
    !!profile &&
    !!group?.creatorLineUserId &&
    group.creatorLineUserId === profile.userId

  const updateActiveUser = () => {
    if (group?.id) {
      if (lineParticipant) setActiveUserForGroup(group.id, lineParticipant.id)
    } else {
      // When creating a group, the current user is always the LINE-linked creator.
      localStorage.setItem(
        'newGroup-activeUser',
        form.getValues('participants.0.name'),
      )
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(async (values) => {
          if (group) {
            sendEvent(
              { event: 'group: update', props: {} },
              `/groups/${group.id}/edit`,
            )
          } else {
            sendEvent({ event: 'group: create', props: {} }, `/groups`)
          }
          const submittedValues =
            !group && profile
              ? {
                  ...values,
                  participants: values.participants.map((participant, index) =>
                    index === 0
                      ? { ...participant, lineUserId: profile.userId }
                      : participant,
                  ),
                }
              : values

          await onSubmit(submittedValues, lineParticipant?.id)
        })}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('NameField.label')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('NameField.placeholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('NameField.description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('CurrencyCodeField.label')}</FormLabel>
                  <CurrencySelector
                    currencies={defaultCurrencyList(
                      locale as Locale,
                      t('CurrencyCodeField.customOption'),
                    )}
                    defaultValue={form.watch(field.name) ?? ''}
                    onValueChange={(newCurrency) => {
                      field.onChange(newCurrency)
                      const currency = getCurrency(newCurrency)
                      if (
                        currency.code.length ||
                        form.getFieldState('currency').isTouched
                      )
                        form.setValue('currency', currency.symbol, {
                          shouldValidate: true,
                          shouldTouch: true,
                          shouldDirty: true,
                        })
                    }}
                    isLoading={false}
                  />
                  <FormDescription>
                    {t(
                      group
                        ? 'CurrencyCodeField.editDescription'
                        : 'CurrencyCodeField.createDescription',
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem hidden={!!form.watch('currencyCode')?.length}>
                  <FormLabel>{t('CurrencyField.label')}</FormLabel>
                  <FormControl>
                    <Input
                      className="text-base"
                      placeholder={t('CurrencyField.placeholder')}
                      max={5}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('CurrencyField.description')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="col-span-2">
              <FormField
                control={form.control}
                name="information"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('InformationField.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="text-base"
                        maxLength={GROUP_INFORMATION_MAX}
                        {...field}
                        placeholder={t('InformationField.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('Participants.title')}</CardTitle>
            <CardDescription>{t('Participants.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Members only join through LINE (see LineParticipantDialog), so
                the list is display only, like the current user field. Only the
                group creator can remove members, other than themselves. The
                list comes from the group itself when editing, so that it
                reflects removals right away. */}
            <ul className="flex flex-col gap-2">
              {(group?.participants ?? fields).map((item, index) => (
                <li key={item.id ?? index} className="flex gap-2">
                  <Input
                    aria-label={`Participant #${index + 1}`}
                    className="text-base"
                    value={item.name}
                    readOnly
                    disabled
                  />
                  {group &&
                    isCreator &&
                    item.id &&
                    item.lineUserId !== group.creatorLineUserId && (
                      <RemoveParticipantButton
                        groupId={group.id}
                        participant={{ id: item.id, name: item.name }}
                        hasExpenses={protectedParticipantIds.includes(item.id)}
                      />
                    )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* When creating a group the current user is always the LINE-linked creator, so hide this setting. */}
        {group && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>{t('Settings.title')}</CardTitle>
              <CardDescription>{t('Settings.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                <FormItem>
                  <FormLabel>{t('Settings.ActiveUserField.label')}</FormLabel>
                  <FormControl>
                    {/* Display only: fixed to the LINE account's name. */}
                    <Input
                      className="text-base"
                      value={
                        profile?.displayName ??
                        lineParticipant?.name ??
                        t('Settings.ActiveUserField.none')
                      }
                      readOnly
                      disabled
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Settings.ActiveUserField.description')}
                  </FormDescription>
                </FormItem>
              </div>
            </CardContent>
          </Card>
        )}
        <div className="flex mt-4 gap-2">
          <SubmitButton
            loadingContent={t(group ? 'Settings.saving' : 'Settings.creating')}
            onClick={updateActiveUser}
          >
            <Save className="w-4 h-4 mr-2" />{' '}
            {t(group ? 'Settings.save' : 'Settings.create')}
          </SubmitButton>
          {!group && (
            <Button variant="ghost" asChild>
              <Link href="/groups">{t('Settings.cancel')}</Link>
            </Button>
          )}
        </div>

        {/* Only the creator (creatorLineUserId) can delete the group. */}
        {enableGroupDeletion && group && !group.deleteAt && isCreator && (
          <Card className="mt-8 border-red-700">
            <CardHeader>
              <CardTitle className="text-red-700">
                {t('Delete.title')}
              </CardTitle>
              <CardDescription>{t('Delete.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DeleteGroupButton group={group} />
            </CardContent>
          </Card>
        )}
      </form>
    </Form>
  )
}
