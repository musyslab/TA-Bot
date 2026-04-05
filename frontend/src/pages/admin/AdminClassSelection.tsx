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
    schools: Array<SchoolObject>
    classes: Array<ClassObject>
    selectedSchoolId: number
    selectedSchoolName: string
    errorMessage: string
}

class AdminClassSelection extends Component<{}, ClassState> {
    constructor(props: {}) {
        super(props)
        this.state = {
            schools: [],
            classes: [],
            selectedSchoolId: -1,
            selectedSchoolName: "",
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

                this.setState({ schools })
            })
            .catch(err => {
                console.error(err)
                this.setState({ errorMessage: "Could not load schools." })
            })
    }

    handleSchoolSelect = (schoolObj: SchoolObject) => {
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
                    errorMessage: ""
                })

            })
            .catch(err => {
                console.error(err)
                this.setState({ errorMessage: "Could not load classes for the selected school." })
            })
    }

    handleBackToSchools = () => {
        this.setState({
            classes: [],
            selectedSchoolId: -1,
            selectedSchoolName: "",
            errorMessage: ""
        })
    }

    render() {
        const { schools, classes, selectedSchoolId, selectedSchoolName, errorMessage } = this.state

        return (
            <div className="admin-landing-root">
                <Helmet>
                    <title>[Admin] TA-Bot</title>
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
                    items={
                        selectedSchoolId === -1
                            ? [{ label: "School Selection" }]
                            : [{ label: "School Selection" }, { label: "Class Selection" }]
                    }
                    trailingSeparator={true}
                />

                <div className="pageTitle">
                    {selectedSchoolId === -1 ? "Select a School" : `Admin Classes · ${selectedSchoolName}`}
                </div>

                <div className="pageTitle">Admin Classes</div>

                <div className="main-grid">
                    <div className="container">

                        <div className="selectorHeader">
                            {selectedSchoolId === -1 ? (
                                <p className="selectorSubtext">Choose a school before selecting a class.</p>
                            ) : (
                                <>
                                    <p className="selectorSubtext">
                                        Showing your classes for {selectedSchoolName}.
                                    </p>
                                    <button type="button" className="secondaryButton" onClick={this.handleBackToSchools}>
                                        Choose a different school
                                    </button>
                                </>
                            )}
                        </div>

                        {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                        <div className="classList">
                            {selectedSchoolId === -1
                                ? schools.map((schoolObj: SchoolObject) => (
                                    <button
                                        key={schoolObj.Id}
                                        type="button"
                                        className="clickableRow schoolCardButton"
                                        onClick={() => this.handleSchoolSelect(schoolObj)}
                                    >
                                        <div>
                                            <img src={codeimg} alt="Code" />
                                        </div>
                                        <div>
                                            <h1 className="title">{schoolObj.Name}</h1>
                                        </div>
                                    </button>
                                ))
                                : classes.map((classObj: ClassObject) => (
                                    <Link
                                        key={classObj.Id}
                                        to={`/admin/${classObj.Id}/projects`}
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

                        {selectedSchoolId === -1 && schools.length === 0 ? (
                            <div className="emptyState">No schools are available yet.</div>
                        ) : null}

                        {selectedSchoolId !== -1 && classes.length === 0 && !errorMessage ? (
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

export default AdminClassSelection