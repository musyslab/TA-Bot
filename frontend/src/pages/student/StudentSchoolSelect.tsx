import { Component, KeyboardEvent } from "react"
import axios from "axios"
import { NavigateFunction, useNavigate } from "react-router-dom"
import { Helmet } from "react-helmet"

import MenuComponent from "../components/MenuComponent"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"
import "../../styling/Selection.scss"

interface SchoolObject {
    Id: number
    Name: string
}

interface SchoolState {
    schools: Array<SchoolObject>
    errorMessage: string
}

interface StudentSchoolSelectProps {
    navigate: NavigateFunction
}

const STUDENT_SELECTED_SCHOOL_STORAGE_KEY = "STUDENT_SELECTED_SCHOOL"

class StudentSchoolSelectInner extends Component<StudentSchoolSelectProps, SchoolState> {
    constructor(props: StudentSchoolSelectProps) {
        super(props)
        this.state = {
            schools: [],
            errorMessage: ""
        }
    }

    componentDidMount() {
        axios
            .get(import.meta.env.VITE_API_URL + `/schools/all`)
            .then(res => {
                const schools: SchoolObject[] = res.data.map(
                    (obj: { id: number; name: string }) => ({
                        Id: obj.id,
                        Name: obj.name
                    })
                )

                schools.sort((a: SchoolObject, b: SchoolObject) =>
                    a.Name.localeCompare(b.Name)
                )

                this.setState({ schools, errorMessage: "" })
            })
            .catch(err => {
                console.error(err)
                this.setState({ errorMessage: "Could not load schools." })
            })
    }

    handleSchoolSelect = (schoolObj: SchoolObject) => {
        localStorage.setItem(STUDENT_SELECTED_SCHOOL_STORAGE_KEY, JSON.stringify(schoolObj))
        this.props.navigate(`/student/school/${schoolObj.Id}/classes`)
    }

    handleSchoolCardKeyDown = (event: KeyboardEvent<HTMLElement>, schoolObj: SchoolObject) => {
        if (event.key !== "Enter" && event.key !== " ") return

        event.preventDefault()
        this.handleSchoolSelect(schoolObj)
    }

    render() {
        const { schools, errorMessage } = this.state

        return (
            <div className="projects-page admin-landing-root">
                <Helmet>
                    <title>MAAT</title>
                </Helmet>

                <MenuComponent
                    showUpload={true}
                    showAdminUpload={false}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <DirectoryBreadcrumbs
                    items={[
                        { label: "School Selection" }
                    ]}
                    trailingSeparator={true}
                />

                <div className="pageTitle">Student School Selection</div>

                <p className="projects-subtitle">
                    Select your school to view your classes.
                </p>

                <section className="module-list-shell" aria-label="School list">
                    <div className="module-list-header-row">
                        <div>
                            <h2>Your Schools</h2>
                        </div>
                    </div>

                    {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                    {schools.length > 0 ? (
                        <div className="module-list-grid">
                            {schools.map((schoolObj: SchoolObject) => (
                                <article
                                    className="module-list-card"
                                    key={schoolObj.Id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => this.handleSchoolSelect(schoolObj)}
                                    onKeyDown={(event) => this.handleSchoolCardKeyDown(event, schoolObj)}
                                    aria-label={`Open ${schoolObj.Name}`}
                                >
                                    <div className="module-list-card-main">
                                        <div className="module-list-card-title-row">
                                            <h3>{schoolObj.Name}</h3>
                                        </div>
                                    </div>

                                    <div className="module-list-card-actions">
                                        <button
                                            type="button"
                                            className="project-action project-action-primary"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                this.handleSchoolSelect(schoolObj)
                                            }}
                                        >
                                            Open School
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : null}

                    {schools.length === 0 && !errorMessage ? (
                        <div className="empty-projects">No schools are available yet.</div>
                    ) : null}
                </section>
            </div>
        )
    }
}

export default function StudentSchoolSelect() {
    const navigate = useNavigate()
    return <StudentSchoolSelectInner navigate={navigate} />
}