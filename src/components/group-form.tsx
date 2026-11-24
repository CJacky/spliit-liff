import { DeleteGroupButton } from '@/components/delete-group-button'
import { useLiff } from '@/components/liff-provider'
import { RemoveParticipantButton } from '@/components/remove-participant-button'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Locale } from '@/i18n/request'
import { useAnalytics } from '@/lib/analytics/context'
import { getGroup } from '@/lib/api'
import { defaultCurrencyList, getCurrency } from '@/lib/currency'
import { setActiveUserForGroup, useActiveUser } from '@/lib/hooks'
import {
  GROUP_INFORMATION_MAX,
  groupFormSchema,
  GroupFormValues,
} from '@/lib/schemas'
import { zodResolver } from '@hookform/resolvers/zod'
import { Save, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
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
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'participants',
    keyName: 'key',
  })
  const sendEvent = useAnalytics()

  const isCreator =
    !!profile &&
    !!group?.creatorLineUserId &&
    group.creatorLineUserId === profile.userId

  // Only the group creator can add, rename and remove participants, and pick
  // the current user, by hand (temporarily allowed again). Whoever creates a
  // group becomes its creator.
  const canManage = !group || isCreator

  // The participant linked to the current LINE account (see LineParticipantDialog).
  const lineParticipant = profile
    ? group?.participants.find(
        ({ lineUserId }) => lineUserId === profile.userId,
      )
    : undefined

  // The creator's pick defaults to the stored one, which LineParticipantDialog
  // initializes to the LINE-linked participant.
  const storedActiveUserId = useActiveUser(group?.id)
  const [activeUser, setActiveUser] = useState<string | null>(null)

  useEffect(() => {
    if (!group) return
    setActiveUser(
      // There is no "none" option: fall back to the LINE-linked participant,
      // or else the first one.
      group.participants.find(({ id }) => id === storedActiveUserId)?.name ??
        lineParticipant?.name ??
        group.participants[0]?.name ??
        null,
    )
  }, [group, storedActiveUserId, lineParticipant?.name])

  // Anyone else is always the LINE-linked participant.
  const activeParticipantId = isCreator
    ? group?.participants.find((p) => p.name === activeUser)?.id
    : lineParticipant?.id

  const updateActiveUser = () => {
    if (group?.id) {
      if (!isCreator) {
        if (lineParticipant) setActiveUserForGroup(group.id, lineParticipant.id)
        return
      }
      if (activeParticipantId) {
        setActiveUserForGroup(group.id, activeParticipantId)
      }
    } else {
      // When creating a group, the current user is always the LINE-linked creator.
      localStorage.setItem(
        'newGroup-activeUser',
        form.getValues('participants.0.name'),
      )
    }
  }

  // Removing a LINE-linked participant is saved right away (see
  // RemoveParticipantButton), so drop them from the form too.
  const removeField = (participantId: string) => {
    const index = form
      .getValues('participants')
      .findIndex(({ id }) => id === participantId)
    if (index >= 0) remove(index)
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

          await onSubmit(submittedValues, activeParticipantId)
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
            {/* Participants not linked to LINE can be added, renamed and
                removed by hand (temporarily allowed again), and are saved with
                the form. Those linked to LINE keep their LINE name, and only
                the group creator can remove them, other than themselves. */}
            <ul className="flex flex-col gap-2">
              {fields.map((item, index) => (
                <li key={item.key}>
                  <FormField
                    control={form.control}
                    name={`participants.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="sr-only">
                          Participant #{index + 1}
                        </FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Input
                              className="text-base"
                              {...field}
                              placeholder={t('Participants.new')}
                              readOnly={!canManage || !!item.lineUserId}
                              disabled={!canManage || !!item.lineUserId}
                            />
                            {!canManage ? null : item.lineUserId ? (
                              group &&
                              isCreator &&
                              item.id &&
                              item.lineUserId !== group.creatorLineUserId && (
                                <RemoveParticipantButton
                                  groupId={group.id}
                                  participant={{ id: item.id, name: item.name }}
                                  hasExpenses={protectedParticipantIds.includes(
                                    item.id,
                                  )}
                                  onRemoved={removeField}
                                />
                              )
                            ) : item.id &&
                              protectedParticipantIds.includes(item.id) ? (
                              <HoverCard>
                                <HoverCardTrigger>
                                  <Button
                                    variant="ghost"
                                    type="button"
                                    size="icon"
                                    disabled
                                  >
                                    <Trash2 className="w-4 h-4 text-destructive opacity-50" />
                                  </Button>
                                </HoverCardTrigger>
                                <HoverCardContent
                                  align="end"
                                  className="text-sm"
                                >
                                  {t('Participants.protectedParticipant')}
                                </HoverCardContent>
                              </HoverCard>
                            ) : (
                              <Button
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => remove(index)}
                                type="button"
                                size="icon"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
          {canManage && (
            <CardFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  append({ name: '' })
                }}
                type="button"
              >
                {t('Participants.add')}
              </Button>
            </CardFooter>
          )}
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
                {!isCreator ? (
                  <FormItem>
                    <FormLabel>{t('Settings.ActiveUserField.label')}</FormLabel>
                    <FormControl>
                      {/* Display only: fixed to the LINE-linked participant. */}
                      <Input
                        className="text-base"
                        value={lineParticipant?.name ?? ''}
                        readOnly
                        disabled
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Settings.ActiveUserField.description')}
                    </FormDescription>
                  </FormItem>
                ) : (
                  activeUser !== null && (
                    <FormItem>
                      <FormLabel>
                        {t('Settings.ActiveUserField.label')}
                      </FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={(value) => {
                            // Radix's hidden native <select> reports '' when
                            // the value changes before its option is
                            // registered (here, once the stored user is read);
                            // no item has an empty value, so ignore it.
                            if (value) setActiveUser(value)
                          }}
                          value={activeUser}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                'Settings.ActiveUserField.placeholder',
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Only saved participants: a new one has no ID yet. */}
                            {group.participants.map(({ name }) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        {t('Settings.ActiveUserField.description')}
                      </FormDescription>
                    </FormItem>
                  )
                )}
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
