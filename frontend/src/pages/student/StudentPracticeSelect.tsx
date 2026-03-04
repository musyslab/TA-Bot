import React, { useEffect, useState } from "react"
import axios from "axios"
import { Helmet } from "react-helmet"
import { Link, useParams } from "react-router-dom"
import MenuComponent from "../components/MenuComponent"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"

type PracticeProblem = {
  id: number
  number: number
  name: string
  enabled: boolean
}

const StudentPracticeSelect: React.FC = () => {
  const { class_id } = useParams()

  const [projectId, setProjectId] = useState<number>(-1)
  const [projectName, setProjectName] = useState<string>("")
  const [practiceProblems, setPracticeProblems] = useState<PracticeProblem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>("")

  // Load current project info (so we know which project's practice problems to list)
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

  // Load practice problems for the current project
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

  return (
    <div className="student-practice-select-page">
      <Helmet>
        <title>TA-Bot</title>
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

      <h1>Practice Problems{projectName ? ` for ${projectName.replace(/_/g, " ")}` : ""}</h1>

      {loading && <div>Loading...</div>}

      {!loading && error && <div>{error}</div>}

      {!loading && !error && projectId <= 0 && (
        <div>No active project. Practice problems are unavailable.</div>
      )}

      {!loading && !error && projectId > 0 && practiceProblems.filter((p) => p && p.enabled).length === 0 && (
        <div>No practice problems are available for this project.</div>
      )}

      {!loading && !error && practiceProblems.length > 0 && (
        <ul>
          {practiceProblems
            .filter((p) => p && p.enabled)
            .map((p) => (
              <li key={p.id}>
                <Link to={`/student/${class_id}/practice/${p.id}/upload`}>
                  {p.number ? `Practice ${p.number}` : "Practice"}:{" "}
                  {p.name || `Practice Problem ${p.number || ""}`}
                </Link>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

export default StudentPracticeSelect