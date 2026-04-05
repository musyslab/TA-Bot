import React, { useCallback, useEffect, useState } from "react"
import { Helmet } from "react-helmet"
import axios from "axios"
import MenuComponent from "../components/MenuComponent"
import codeimg from "../../images/codeex.png"
import "../../styling/Classes.scss"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"

const ClassSelectionPage: React.FC = () => {
    const [schools, setSchools] = useState<Array<{ id: number; name: string }>>([])
    const [studentClasses, setStudentClasses] = useState<Array<{ id: number; name: string }>>([])
    const [selectedSchoolId, setSelectedSchoolId] = useState<number>(-1)
    const [selectedSchoolName, setSelectedSchoolName] = useState<string>("")
    const [errorMessage, setErrorMessage] = useState<string>("")

    const loadSchools = useCallback(() => {
        axios
            .get(import.meta.env.VITE_API_URL + `/schools/all`)
            .then((res) => {
                const rows = Array.isArray(res.data) ? res.data : []
                rows.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
                setSchools(rows)
            })
            .catch(() => {
                setErrorMessage("Could not load schools.")
            })
    }, [])

    const loadClasses = useCallback((schoolId: number) => {
        axios
            .get(import.meta.env.VITE_API_URL + `/class/all?filter=true&school_id=${schoolId}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                const rows = Array.isArray(res.data) ? res.data : []
                rows.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
                setStudentClasses(rows)
                setErrorMessage("")
            })
            .catch(() => {
                setErrorMessage("Could not load classes for the selected school.")
            })
    }, [])

    const handleSchoolSelect = (school: { id: number; name: string }) => {
        setSelectedSchoolId(school.id)
        setSelectedSchoolName(school.name)
        setStudentClasses([])
        setErrorMessage("")
        loadClasses(school.id)
    }

    const handleBackToSchools = () => {
        setSelectedSchoolId(-1)
        setSelectedSchoolName("")
        setStudentClasses([])
        setErrorMessage("")
    }

    useEffect(() => {
        loadSchools()
    }, [loadSchools])

    return (
        <div id="code-page" className="admin-landing-root">
            <Helmet>
                <title>TA-Bot</title>
            </Helmet>

            <MenuComponent
                showUpload={true}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <div className="main-grid">
                <DirectoryBreadcrumbs
                    items={
                        selectedSchoolId === -1
                            ? [{ label: "School Selection" }]
                            : [{ label: "School Selection" }, { label: "Class Selection" }]
                    }
                    trailingSeparator={true}
                />

                <div className="pageTitle">
                    {selectedSchoolId === -1 ? "Select a School" : `Student Classes · ${selectedSchoolName}`}
                </div>

                <div className="main-grid">

                    <div className="container">
                        <div className="selectorHeader">
                            {selectedSchoolId === -1 ? (
                                <p className="selectorSubtext">Choose your school before selecting a class.</p>
                            ) : (
                                <>
                                    <p className="selectorSubtext">
                                        Showing your assigned classes for {selectedSchoolName}.
                                    </p>
                                    <button type="button" className="secondaryButton" onClick={handleBackToSchools}>
                                        Choose a different school
                                    </button>
                                </>
                            )}
                        </div>

                        {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                        <div className="classList">
                            {selectedSchoolId === -1
                                ? schools.map((school) => (
                                    <button
                                        key={school.id}
                                        type="button"
                                        className="clickableRow schoolCardButton"
                                        onClick={() => handleSchoolSelect(school)}
                                    >
                                        <div>
                                            <img src={codeimg} alt="Code" />
                                        </div>
                                        <div>
                                            <h1 className="title">{school.name}</h1>
                                        </div>
                                    </button>
                                ))
                                : studentClasses.map((classObj) => (
                                    <a
                                        key={classObj.id}
                                        href={`/student/${classObj.id}/upload`}
                                        className="clickableRow"
                                    >
                                        <div>
                                            <img src={codeimg} alt="Code" />
                                        </div>
                                        <div>
                                            <h1 className="title">{classObj.name}</h1>
                                        </div>
                                    </a>
                                ))}
                        </div>

                        {selectedSchoolId === -1 && schools.length === 0 ? (
                            <div className="emptyState">No schools are available yet.</div>
                        ) : null}

                        {selectedSchoolId !== -1 && studentClasses.length === 0 && !errorMessage ? (
                            <div className="emptyState">
                                No classes are currently assigned to you for this school.
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ClassSelectionPage
