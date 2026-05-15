import { Component, KeyboardEvent } from 'react'
import axios from 'axios'
import { Link, NavigateFunction, useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import '../../styling/Selection.scss'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"

interface ClassObject {
    Id: number
    Name: string
}

interface SchoolObject {
    Id: number
    Name: string
}

interface ClassState {
    classes: Array<ClassObject>
    selectedSchoolId: number
    selectedSchoolName: string
    errorMessage: string
    isLoading: boolean
}

interface AdminClassSelectProps {
    schoolIdFromUrl: string
    navigate: NavigateFunction
}

const ADMIN_SELECTED_SCHOOL_STORAGE_KEY = "ADMIN_SELECTED_SCHOOL"

class AdminClassSelectInner extends Component<AdminClassSelectProps, ClassState> {
    constructor(props: AdminClassSelectProps) {
        super(props)
        this.state = {
            classes: [],
            selectedSchoolId: -1,
            selectedSchoolName: "",
            errorMessage: "",
            isLoading: true
        }
    }

    componentDidMount() {
        const schoolId = Number(this.props.schoolIdFromUrl)

        if (!schoolId || Number.isNaN(schoolId)) {
            this.setState({
                classes: [],
                selectedSchoolId: -1,
                selectedSchoolName: "",
                errorMessage: "Please select a school first.",
                isLoading: false
            })
            return
        }

        const storedSchool = this.getStoredSelectedSchool()

        if (storedSchool && storedSchool.Id === schoolId) {
            this.loadClassesForSchool(storedSchool)
            return
        }

        this.loadSchoolAndClasses(schoolId)
    }

    componentDidUpdate(prevProps: AdminClassSelectProps) {
        if (prevProps.schoolIdFromUrl === this.props.schoolIdFromUrl) return

        const schoolId = Number(this.props.schoolIdFromUrl)

        if (!schoolId || Number.isNaN(schoolId)) {
            this.setState({
                classes: [],
                selectedSchoolId: -1,
                selectedSchoolName: "",
                errorMessage: "Please select a school first.",
                isLoading: false
            })
            return
        }

        this.loadSchoolAndClasses(schoolId)
    }

    getStoredSelectedSchool = (): SchoolObject | null => {
        const storedValue = localStorage.getItem(ADMIN_SELECTED_SCHOOL_STORAGE_KEY)
        if (!storedValue) return null

        try {
            const parsed = JSON.parse(storedValue) as SchoolObject

            if (!parsed || typeof parsed.Id !== "number" || !parsed.Name) {
                return null
            }

            return parsed
        } catch {
            return null
        }
    }

    loadSchoolAndClasses = (schoolId: number) => {
        this.setState({
            classes: [],
            selectedSchoolId: schoolId,
            selectedSchoolName: "",
            errorMessage: "",
            isLoading: true
        })

        axios
            .get(import.meta.env.VITE_API_URL + `/schools/all`)
            .then(res => {
                const schools: SchoolObject[] = res.data.map(
                    (obj: { id: number; name: string }) => ({
                        Id: obj.id,
                        Name: obj.name
                    })
                )

                const matchingSchool = schools.find((schoolObj: SchoolObject) => schoolObj.Id === schoolId)

                if (!matchingSchool) {
                    this.setState({
                        classes: [],
                        selectedSchoolId: schoolId,
                        selectedSchoolName: "",
                        errorMessage: "The selected school could not be found.",
                        isLoading: false
                    })
                    return
                }

                localStorage.setItem(ADMIN_SELECTED_SCHOOL_STORAGE_KEY, JSON.stringify(matchingSchool))
                this.loadClassesForSchool(matchingSchool)
            })
            .catch(err => {
                console.error(err)
                this.setState({
                    classes: [],
                    selectedSchoolId: schoolId,
                    selectedSchoolName: "",
                    errorMessage: "Could not load the selected school.",
                    isLoading: false
                })
            })
    }

    loadClassesForSchool = (schoolObj: SchoolObject) => {
        this.setState({
            classes: [],
            selectedSchoolId: schoolObj.Id,
            selectedSchoolName: schoolObj.Name,
            errorMessage: "",
            isLoading: true
        })

        axios
            .get(import.meta.env.VITE_API_URL + `/class/all?filter=true&school_id=${schoolObj.Id}`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`
                }
            })
            .then(res => {
                const classes: ClassObject[] = res.data.map(
                    (obj: { id: number; name: string }) => ({
                        Id: obj.id,
                        Name: obj.name
                    })
                )

                classes.sort((a: ClassObject, b: ClassObject) =>
                    a.Name.localeCompare(b.Name)
                )

                this.setState({
                    classes,
                    selectedSchoolId: schoolObj.Id,
                    selectedSchoolName: schoolObj.Name,
                    errorMessage: "",
                    isLoading: false
                })
            })
            .catch(err => {
                console.error(err)
                this.setState({
                    classes: [],
                    selectedSchoolId: schoolObj.Id,
                    selectedSchoolName: schoolObj.Name,
                    errorMessage: "Could not load classes for the selected school.",
                    isLoading: false
                })
            })
    }

    handleClassCardKeyDown = (event: KeyboardEvent<HTMLElement>, classObj: ClassObject) => {
        if (event.key !== "Enter" && event.key !== " ") return

        event.preventDefault()
        this.props.navigate(this.getClassModulesUrl(classObj.Id))
    }

    getClassModulesUrl = (classId: number): string => {
        return `/admin/school/${this.state.selectedSchoolId}/class/${classId}/modules`
    }

    render() {
        const { classes, selectedSchoolId, selectedSchoolName, errorMessage, isLoading } = this.state
        const hasSelectedSchool = selectedSchoolId !== -1

        return (
            <div className="projects-page admin-landing-root">
                <Helmet>
                    <title>[Admin] MAAT</title>
                </Helmet>

                <MenuComponent
                    showUpload={false}
                    showAdminUpload={true}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                ></MenuComponent>

                <DirectoryBreadcrumbs
                    items={[
                        { label: "School Selection", to: "/admin/schools" },
                        { label: "Class Selection" }
                    ]}
                    trailingSeparator={true}
                />

                <div className="pageTitle">
                    {hasSelectedSchool && selectedSchoolName ? `Admin · ${selectedSchoolName}` : "Admin Class Selection"}
                </div>

                <p className="projects-subtitle">
                    Select a class to view its modules.
                </p>

                <section className="module-list-shell" aria-label="Class list">
                    <div className="module-list-header-row">
                        <div>
                            <h2>{selectedSchoolName} Classes</h2>
                        </div>
                    </div>

                    {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                    {!hasSelectedSchool ? (
                        <Link
                            to="/admin/schools"
                            className="project-action project-action-secondary"
                        >
                            Go to School Selection
                        </Link>
                    ) : null}

                    {isLoading && hasSelectedSchool ? (
                        <div className="empty-projects">Loading classes...</div>
                    ) : null}

                    {!isLoading && hasSelectedSchool && classes.length > 0 ? (
                        <div className="module-list-grid">
                            {classes.map((classObj: ClassObject) => (
                                <article
                                    className="module-list-card"
                                    key={classObj.Id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => this.props.navigate(this.getClassModulesUrl(classObj.Id))}
                                    onKeyDown={(event) => this.handleClassCardKeyDown(event, classObj)}
                                    aria-label={`Open ${classObj.Name}`}
                                >
                                    <div className="module-list-card-main">
                                        <div className="module-list-card-title-row">
                                            <h3>{classObj.Name}</h3>
                                        </div>
                                    </div>

                                    <div className="module-list-card-actions">
                                        <Link
                                            to={this.getClassModulesUrl(classObj.Id)}
                                            className="project-action project-action-primary"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            Open Class
                                        </Link>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : null}

                    {!isLoading && hasSelectedSchool && classes.length === 0 && !errorMessage ? (
                        <div className="empty-projects">
                            No classes are currently available for this school.
                        </div>
                    ) : null}
                </section>
            </div>
        )
    }
}

export default function AdminClassSelect() {
    const navigate = useNavigate()
    const { school_id } = useParams<{ school_id: string }>()

    return <AdminClassSelectInner navigate={navigate} schoolIdFromUrl={school_id || ""} />
}