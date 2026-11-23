import { HomeRedirect } from '@/app/home-redirect'
import { redirect } from 'next/navigation'

// 首頁直接進群組列表。
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // 帶有查詢參數時（LIFF 的 liff.state 深層連結、LINE 登入回呼的 code 等），
  // 不能在 server 端轉址，否則參數會遺失；交給 LIFF 處理完再由 client 轉址。
  if (Object.keys(await searchParams).length === 0) redirect('/groups')
  return <HomeRedirect />
}
