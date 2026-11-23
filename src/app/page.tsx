import { HomeRedirect } from '@/app/home-redirect'
import { redirect } from 'next/navigation'

// The home page goes straight to the group list.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // With query params (LIFF liff.state deep links, LINE login callback code, etc.)
  // we must not redirect on the server or the params are lost; let LIFF handle them, then redirect on the client.
  if (Object.keys(await searchParams).length === 0) redirect('/groups')
  return <HomeRedirect />
}
