'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * 只會在 LiffProvider 完成登入後才渲染。若網址帶 liff.state，
 * LIFF 會自行導向深層連結的目標頁，這裡不搶著轉址；否則進群組列表。
 */
export function HomeRedirect() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('liff.state')) return
    router.replace('/groups')
  }, [router])

  return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  )
}
