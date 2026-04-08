// StudentPracticeSelect.tsx
import React, { useEffect, useMemo, useState } from "react"
import axios from "axios"
import { Helmet } from "react-helmet"
import { Link, useParams } from "react-router-dom"
import MenuComponent from "../components/MenuComponent"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import "../../styling/StudentPracticeSelect.scss"

import { FaCheckCircle, FaGift, FaLock, FaFlask, FaExternalLinkAlt } from "react-icons/fa"

type PracticeProblem = {
  id: number
  number: number
  name: string
  enabled: boolean
  solved?: boolean
  rewarded?: boolean
}

const StudentPracticeSelect: React.FC = () => {
  const { class_id } = useParams()

  const [projectId, setProjectId] = useState<number>(-1)
  const [projectName, setProjectName] = useState<string>("")
  const [practiceProblems, setPracticeProblems] = useState<PracticeProblem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>("")

  // Load current project info
  useEffect(() => {
    const cid = Number(class_id)

    if (!Number.isFinite(cid) || cid <= 0) {
      setError("Invalid class id.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")

    axios
      .get(`${import.meta.env.VITE_API_URL}/submissions/GetSubmissionDetails?class_id=${cid}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
      })
      .then((res) => {
        const pid = Number(res?.data?.[5] ?? -1)
        const pname = String(res?.data?.[3] ?? "")

        setProjectId(pid)
        setProjectName(pname)
      })
      .catch(() => {
        setProjectId(-1)
        setProjectName("")
      })
  }, [class_id])

  // Load practice problems
  useEffect(() => {
    if (!projectId || projectId <= 0) {
      setPracticeProblems([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")

    axios
      .get(`${import.meta.env.VITE_API_URL}/projects/list_practice_problems_student?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}` },
      })
      .then((res) => {
        const probs = (res?.data?.problems ?? []) as PracticeProblem[]
        setPracticeProblems(Array.isArray(probs) ? probs : [])
        setLoading(false)
      })
      .catch(() => {
        setError("Failed to load practice problems.")
        setPracticeProblems([])
        setLoading(false)
      })
  }, [projectId])

  const enabledProblems = useMemo(
    () => practiceProblems.filter((p) => p && p.enabled),
    [practiceProblems]
  )

  const progress = useMemo(() => {
    const total = enabledProblems.length
    const awarded = enabledProblems.filter((p) => Boolean(p.rewarded)).length
    const solved = enabledProblems.filter((p) => Boolean(p.solved)).length
    const pct = total === 0 ? 0 : Math.round((awarded / total) * 100)
    return { total, awarded, solved, pct }
  }, [enabledProblems])

  const titleText = useMemo(() => {
    const base = "Practice Problems"
    if (!projectName) return base
    return `${base} for ${projectName.replace(/_/g, " ")}`
  }, [projectName])

  const getStatusChip = (p: PracticeProblem) => {
    if (p.rewarded) {
      return (
        <span className="status-chip status-chip--awarded" title="Bonus FastPass charge awarded for this problem">
          <FaGift aria-hidden="true" />
          Awarded
        </span>
      )
    }
    if (p.solved) {
      return (
        <span className="status-chip status-chip--solved" title="Solved, but bonus not awarded yet">
          <FaCheckCircle aria-hidden="true" />
          Solved
        </span>
      )
    }
    return (
      <span className="status-chip status-chip--unsolved" title="Not solved yet">
        <FaLock aria-hidden="true" />
        Not solved
      </span>
    )
  }

  return (
    <div className="student-practice-select-page">
      <Helmet>
        <title>MAAT</title>
      </Helmet>

      <MenuComponent
        showAdminUpload={false}
        showUpload={false}
        showHelp={false}
        showCreate={false}
        showLast={true}
        showReviewButton={false}
      />

      <DirectoryBreadcrumbs
        items={[
          { label: "Class Selection", to: "/student/classes" },
          { label: "Project Upload", to: `/student/${class_id}/upload` },
          { label: "Practice Problems" },
        ]}
      />

      {/* Match Class Selection heading style from Directory.scss */}
      <div className="pageTitle">{titleText}</div>

      <div className="practice-content">
        {loading && (
          <div className="state state--loading">
            <div className="spinner" aria-hidden="true" />
            <div>Loading practice problems...</div>
          </div>
        )}

        {!loading && error && <div className="state state--error">{error}</div>}

        {!loading && !error && projectId <= 0 && (
          <div className="state state--empty">
            No active project. Practice problems are unavailable.
          </div>
        )}

        {!loading && !error && projectId > 0 && enabledProblems.length === 0 && (
          <div className="state state--empty">No practice problems are available for this project.</div>
        )}

        {!loading && !error && projectId > 0 && enabledProblems.length > 0 && (
          <>
            <section className="progress-card" aria-label="Practice bonus progress">
              <div className="progress-card__top">
                <div className="progress-card__label">
                  <FaFlask aria-hidden="true" /> Practice bonus progress
                </div>

                <div className="progress-card__value">
                  <span className="big">{progress.awarded}</span>
                  <span className="muted"> / {progress.total}</span>
                </div>
              </div>

              <div className="progress">
                <div
                  className="progress-bar"
                  role="progressbar"
                  aria-valuenow={progress.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="progress-bar__fill" style={{ width: `${progress.pct}%` }} />
                </div>

                <div className="progress-subtle">
                  Bonus FastPass charges awarded: <b>{progress.awarded}</b>. Solved: <b>{progress.solved}</b>.
                  Each solved practice problem should award 1 bonus FastPass charge.
                </div>
              </div>
            </section>

            <ul className="practice-list" aria-label="Practice problems list">
              {enabledProblems
                .slice()
                .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
                .map((p) => {
                  const labelLeft = p.number ? `Practice ${p.number}` : "Practice"
                  const labelRight = p.name || `Practice Problem ${p.number || ""}`

                  return (
                    <li key={p.id} className="practice-item">
                      <Link to={`/student/${class_id}/practice/${p.id}/upload`} className="practice-card">
                        <div className="practice-card__left">
                          <div className="practice-title">
                            <span className="practice-kicker">{labelLeft}</span>
                            <span className="practice-name">{labelRight}</span>
                          </div>

                          <div className="practice-meta">
                            {getStatusChip(p)}
                            {!p.rewarded && p.solved && (
                              <span className="hint-chip" title="If you just solved it, refresh in a moment">
                                Bonus pending
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="practice-card__right" aria-hidden="true" title="Go to upload">
                          <FaExternalLinkAlt />
                        </div>
                      </Link>
                    </li>
                  )
                })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

export default StudentPracticeSelect