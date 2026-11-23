'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Only rendered after LiffProvider has finished logging in. If the URL carries liff.state,
 * LIFF navigates to the deep link target itself, so don't redirect here; otherwise go to the group list.
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
