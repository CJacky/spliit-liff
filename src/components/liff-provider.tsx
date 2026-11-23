'use client'

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import {
  createContext,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

type LiffProfile = {
  userId: string
  displayName: string
}

type LiffContextValue = {
  isReady: boolean
  isLoggedIn: boolean
  profile: LiffProfile | null
  error: Error | null
}

type Liff = (typeof import('@line/liff'))['default']

const LiffContext = createContext<LiffContextValue | null>(null)

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '2012765573-U3h3wIyL'

/**
 * Enforce LINE login: when logged out, always redirect to LINE Login (inside or outside the LINE app).
 * Nothing is rendered until the LINE userId / displayName is available,
 * so descendant components can assume the profile always exists.
 */
export function LiffProvider({ children }: PropsWithChildren) {
  const [value, setValue] = useState<LiffContextValue>({
    isReady: false,
    isLoggedIn: false,
    profile: null,
    error: null,
  })
  // If the user cancels on the LINE login page they come back with ?error=...; don't auto-redirect
  // again or we loop forever. Show a "log in with LINE" button for the user to press instead.
  const [loginCancelled, setLoginCancelled] = useState(false)
  const liffRef = useRef<Liff | null>(null)

  const login = useCallback(() => {
    liffRef.current?.login({ redirectUri: window.location.href })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initializeLiff() {
      const mockUserId = process.env.NEXT_PUBLIC_MOCK_LIFF_USER_ID
      if (mockUserId) {
        setValue({
          isReady: true,
          isLoggedIn: true,
          profile: {
            userId: mockUserId,
            displayName: process.env.NEXT_PUBLIC_MOCK_LIFF_NAME || '測試用戶',
          },
          error: null,
        })
        return
      }

      try {
        const { default: liff } = await import('@line/liff')
        liffRef.current = liff
        await liff.init({ liffId: LIFF_ID })
        if (cancelled) return

        if (!liff.isLoggedIn()) {
          setValue({
            isReady: true,
            isLoggedIn: false,
            profile: null,
            error: null,
          })
          const params = new URLSearchParams(window.location.search)
          if (params.has('error')) {
            setLoginCancelled(true)
          } else {
            liff.login({ redirectUri: window.location.href })
          }
          return
        }

        const { userId, displayName } = await liff.getProfile()
        if (cancelled) return
        setValue({
          isReady: true,
          isLoggedIn: true,
          profile: { userId, displayName },
          error: null,
        })
      } catch (cause) {
        if (cancelled) return
        setValue({
          isReady: true,
          isLoggedIn: false,
          profile: null,
          error:
            cause instanceof Error
              ? cause
              : new Error('Failed to initialize LIFF', { cause }),
        })
      }
    }

    void initializeLiff()
    return () => {
      cancelled = true
    }
  }, [])

  let content: ReactNode
  if (value.error) {
    content = (
      <LiffGate>
        <p className="text-destructive">無法連線 LINE，請稍後再試。</p>
        <p className="text-xs text-muted-foreground break-all">
          {value.error.message}
        </p>
        <Button onClick={() => window.location.reload()}>重新載入</Button>
      </LiffGate>
    )
  } else if (value.profile) {
    content = children
  } else if (loginCancelled) {
    content = (
      <LiffGate>
        <p>需要登入 LINE 才能使用分帳功能。</p>
        <Button onClick={login}>使用 LINE 登入</Button>
      </LiffGate>
    )
  } else {
    content = (
      <LiffGate>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">正在登入 LINE…</p>
      </LiffGate>
    )
  }

  return <LiffContext.Provider value={value}>{content}</LiffContext.Provider>
}

function LiffGate({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      {children}
    </div>
  )
}

export function useLiff() {
  const context = useContext(LiffContext)
  if (!context) throw new Error('useLiff must be used inside LiffProvider')
  return context
}
