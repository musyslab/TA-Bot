import React, { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import axios from 'axios'
import ErrorBoundary from './ErrorComponent'

interface RouteScope {
  section: "admin" | "student"
  schoolId: string | null
  classId: string | null
}

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
    localStorage.removeItem("AUTOTA_USER_ROLE")
    return null
  }

  return cleanedToken
}

const clearStoredAuth = () => {
  localStorage.removeItem("AUTOTA_AUTH_TOKEN")
  localStorage.removeItem("AUTOTA_USER_ROLE")
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

const getKickoutPath = (section: "admin" | "student"): string => {
  return section === "admin" ? "/admin/schools" : "/student/schools"
}

const pageLoadsAndValidatesOwnSchoolScope = (pathname: string): boolean => {
  return /^\/(admin|student)\/school\/\d+\/classes\/?$/.test(pathname)
}

const getAccessCacheKey = (pathname: string): string | null => {
  const scope = getRouteScope(pathname)

  if (!scope || !scope.schoolId || pageLoadsAndValidatesOwnSchoolScope(pathname)) {
    return null
  }

  return `${scope.section}:${scope.schoolId}:${scope.classId || "school"}`
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation()
  const token = getValidStoredToken()
  const accessCacheKey = useMemo(() => getAccessCacheKey(location.pathname), [location.pathname])
  const [isCheckingAccess, setIsCheckingAccess] = useState(Boolean(token && accessCacheKey))
  const [checkedAccessKey, setCheckedAccessKey] = useState<string | null>(null)
  const [hasAccess, setHasAccess] = useState(true)
  const [kickoutPath, setKickoutPath] = useState("/login")

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

      const cachedAccess = sessionStorage.getItem(accessCacheKey)
      if (cachedAccess === "ok") {
        if (isMounted) {
          setHasAccess(true)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }
        return
      }

      setIsCheckingAccess(true)

      try {
        const headers = {
          Authorization: `Bearer ${token}`
        }

        if (scope.classId) {
          await axios.get(`${import.meta.env.VITE_API_URL}/class/id/${scope.classId}/access?school_id=${scope.schoolId}`, {
            headers
          })
        } else {
          await axios.get(`${import.meta.env.VITE_API_URL}/schools/id/${scope.schoolId}/access`, {
            headers
          })
        }

        sessionStorage.setItem(accessCacheKey, "ok")

        if (isMounted) {
          setHasAccess(true)
          setCheckedAccessKey(accessCacheKey)
          setIsCheckingAccess(false)
        }
      } catch (err: any) {
        sessionStorage.removeItem(accessCacheKey)

        if (err?.response?.status === 401 || err?.response?.status === 422 || err?.response?.status === 403) {
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
  }, [accessCacheKey, location.pathname, token])

  if (!token) {
    clearStoredAuth()
    return <Navigate to="/login" replace />
  }

  if (isCheckingAccess || (accessCacheKey && checkedAccessKey !== accessCacheKey)) {
    return <div className="pageMessage">Checking access...</div>
  }

  if (!hasAccess) {
    return <Navigate to={kickoutPath} replace />
  }

  return <ErrorBoundary>{children ? children : <Outlet />}</ErrorBoundary>
}

export default ProtectedRoute