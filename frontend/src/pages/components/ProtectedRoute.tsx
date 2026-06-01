import React, { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import axios from 'axios'
import ErrorBoundary from './ErrorComponent'

interface RouteScope {
  section: "admin" | "student"
  schoolId: string | null
  classId: string | null
}

const ACCESS_CHECK_MESSAGE_DELAY_MS = 350
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000

const successfulAccessCache = new Map<string, number>()
const pendingAccessChecks = new Map<string, Promise<void>>()

const getValidStoredToken = (): string | null => {
  const token = localStorage.getItem("AUTOTA_AUTH_TOKEN")

  if (!token) {
    return null
  }

  const cleanedToken = token.trim()

  if (
    !cleanedToken ||
    cleanedToken.toLowerCase() === "null" ||
    cleanedToken.toLowerCase() === "undefined"
  ) {
    localStorage.removeItem("AUTOTA_AUTH_TOKEN")
    return null
  }

  return cleanedToken
}

const clearStoredAuth = () => {
  localStorage.removeItem("AUTOTA_AUTH_TOKEN")
}

const getRouteScope = (pathname: string): RouteScope | null => {
  const match = pathname.match(/^\/(admin|student)\/school\/(\d+)(?:\/class\/(\d+))?(?:\/|$)/)

  if (!match) {
    return null
  }

  return {
    section: match[1] as "admin" | "student",
    schoolId: match[2] || null,
    classId: match[3] || null
  }
}

const getKickoutPath = (_section: "admin" | "student"): string => {
  return "/schools"
}

const getAccessCacheKey = (pathname: string): string | null => {
  const scope = getRouteScope(pathname)

  if (!scope || !scope.schoolId) {
    return null
  }

  return `${scope.section}:${scope.schoolId}:${scope.classId || "school"}`
}

const getSessionAccessCacheKey = (token: string | null, accessCacheKey: string | null): string | null => {
  if (!token || !accessCacheKey) {
    return null
  }

  return `${token}:${accessCacheKey}`
}

const hasFreshCachedAccess = (sessionAccessCacheKey: string | null): boolean => {
  if (!sessionAccessCacheKey) {
    return false
  }

  const cachedAt = successfulAccessCache.get(sessionAccessCacheKey)

  if (!cachedAt) {
    return false
  }

  if (Date.now() - cachedAt > ACCESS_CACHE_TTL_MS) {
    successfulAccessCache.delete(sessionAccessCacheKey)
    return false
  }

  return true
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation()
  const token = getValidStoredToken()
  const accessCacheKey = useMemo(() => getAccessCacheKey(location.pathname), [location.pathname])
  const sessionAccessCacheKey = useMemo(
    () => getSessionAccessCacheKey(token, accessCacheKey),
    [token, accessCacheKey]
  )

  const startsWithCachedAccess = hasFreshCachedAccess(sessionAccessCacheKey)

  const [isCheckingAccess, setIsCheckingAccess] = useState(Boolean(token && accessCacheKey && !startsWithCachedAccess))
  const [showAccessMessage, setShowAccessMessage] = useState(false)
  const [checkedAccessKey, setCheckedAccessKey] = useState<string | null>(startsWithCachedAccess ? accessCacheKey : null)
  const [hasAccess, setHasAccess] = useState(!token ? false : startsWithCachedAccess || !accessCacheKey)
  const [kickoutPath, setKickoutPath] = useState("/login")

  useEffect(() => {
    if (!isCheckingAccess) {
      setShowAccessMessage(false)
      return
    }

    setShowAccessMessage(false)

    const messageDelay = window.setTimeout(() => {
      setShowAccessMessage(true)
    }, ACCESS_CHECK_MESSAGE_DELAY_MS)

    return () => {
      window.clearTimeout(messageDelay)
    }
  }, [isCheckingAccess, accessCacheKey])

  useEffect(() => {
    let isMounted = true

    const checkAccess = async () => {
      if (!token) {
        clearStoredAuth()

        if (isMounted) {
          setKickoutPath("/login")
          setHasAccess(false)
          setCheckedAccessKey(null)
          setIsCheckingAccess(false)
        }

        return
      }

      const scope = getRouteScope(location.pathname)

      if (!scope || !scope.schoolId || !accessCacheKey) {
        if (isMounted) {
          setHasAccess(true)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }

        return
      }

      if (hasFreshCachedAccess(sessionAccessCacheKey)) {
        if (isMounted) {
          setHasAccess(true)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }

        return
      }

      if (isMounted) {
        setIsCheckingAccess(true)
      }

      try {
        const headers = {
          Authorization: `Bearer ${token}`
        }
        const roleContext = encodeURIComponent(scope.section)

        const accessRequest = async () => {
          if (scope.classId) {
            await axios.get(
              `${import.meta.env.VITE_API_URL}/class/id/${scope.classId}/access?school_id=${scope.schoolId}&role_context=${roleContext}`,
              { headers }
            )
          } else {
            await axios.get(
              `${import.meta.env.VITE_API_URL}/class/all?school_id=${scope.schoolId}&role_context=${roleContext}`,
              { headers }
            )
          }

          if (sessionAccessCacheKey) {
            successfulAccessCache.set(sessionAccessCacheKey, Date.now())
          }
        }

        const pendingCheck = sessionAccessCacheKey ? pendingAccessChecks.get(sessionAccessCacheKey) : null

        if (pendingCheck) {
          await pendingCheck
        } else {
          const newPendingCheck = accessRequest()

          if (sessionAccessCacheKey) {
            pendingAccessChecks.set(sessionAccessCacheKey, newPendingCheck)

            newPendingCheck.finally(() => {
              if (pendingAccessChecks.get(sessionAccessCacheKey) === newPendingCheck) {
                pendingAccessChecks.delete(sessionAccessCacheKey)
              }
            })
          }

          await newPendingCheck
        }

        if (isMounted) {
          setHasAccess(true)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }
      } catch (err: any) {
        if (err?.response?.status === 401 || err?.response?.status === 422) {
          clearStoredAuth()

          if (isMounted) {
            setKickoutPath("/login")
            setHasAccess(false)
            setCheckedAccessKey(accessCacheKey)
            setIsCheckingAccess(false)
          }

          return
        }

        if (isMounted) {
          setKickoutPath(getKickoutPath(scope.section))
          setHasAccess(false)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }
      }
    }

    checkAccess()

    return () => {
      isMounted = false
    }
  }, [accessCacheKey, location.pathname, sessionAccessCacheKey, token])

  if (!token) {
    clearStoredAuth()
    return <Navigate to="/login" replace />
  }

  if (isCheckingAccess || (accessCacheKey && checkedAccessKey !== accessCacheKey)) {
    if (!showAccessMessage) {
      return null
    }

    return (
      <div className="pageMessage" role="status" aria-live="polite" aria-busy="true">
        Preparing page...
      </div>
    )
  }

  if (!hasAccess) {
    return <Navigate to={kickoutPath} replace />
  }

  return <ErrorBoundary>{children ? children : <Outlet />}</ErrorBoundary>
}

export default ProtectedRoute