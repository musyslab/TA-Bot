import { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import codeimg from '../../images/codeex.png'
import '../../styling/Classes.scss'
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

const ADMIN_SELECTED_SCHOOL_STORAGE_KEY = "ADMIN_SELECTED_SCHOOL"

class AdminClassSelect extends Component<{}, ClassState> {
    constructor(props: {}) {
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
        const storedSchool = this.getStoredSelectedSchool()

        if (!storedSchool) {
            this.setState({
                classes: [],
                selectedSchoolId: -1,
                selectedSchoolName: "",
                errorMessage: "Please select a school first.",
                isLoading: false
            })
            return
        }

        this.loadClassesForSchool(storedSchool)
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

    render() {
        const { classes, selectedSchoolId, selectedSchoolName, errorMessage, isLoading } = this.state
        const hasSelectedSchool = selectedSchoolId !== -1

        return (
            <div className="admin-landing-root">
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
                    {hasSelectedSchool ? `Admin · ${selectedSchoolName}` : "Admin Class Selection"}
                </div>

                <div className="main-grid">
                    <div className="container">
                        {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                        {!hasSelectedSchool ? (
                            <Link
                                to="/admin/schools"
                                className="secondaryButton"
                            >
                                Go to School Selection
                            </Link>
                        ) : null}

                        {isLoading && hasSelectedSchool ? (
                            <div className="emptyState">Loading classes...</div>
                        ) : null}

                        {!isLoading && hasSelectedSchool ? (
                            <div className="classList">
                                {classes.map((classObj: ClassObject) => (
                                    <Link
                                        key={classObj.Id}
                                        to={`/admin/${classObj.Id}/modules`}
                                        className="clickableRow"
                                    >
                                        <div>
                                            <img src={codeimg} alt="Code" />
                                        </div>
                                        <div>
                                            <h1 className="title">{classObj.Name}</h1>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : null}

                        {!isLoading && hasSelectedSchool && classes.length === 0 && !errorMessage ? (
                            <div className="emptyState">
                                No classes are currently available for this school.
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        )
    }
}

export default AdminClassSelect