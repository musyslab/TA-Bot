import { Component } from 'react'
import axios from 'axios'
import { NavigateFunction, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import codeimg from '../../images/codeex.png'
import '../../styling/Classes.scss'
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"

interface SchoolObject {
    Id: number
    Name: string
}

interface SchoolState {
    schools: Array<SchoolObject>
    errorMessage: string
}

const ADMIN_SELECTED_SCHOOL_STORAGE_KEY = "ADMIN_SELECTED_SCHOOL"

interface AdminSchoolSelectProps {
    navigate: NavigateFunction
}

class AdminSchoolSelectInner extends Component<AdminSchoolSelectProps, SchoolState> {
    constructor(props: AdminSchoolSelectProps) {
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
        localStorage.setItem(ADMIN_SELECTED_SCHOOL_STORAGE_KEY, JSON.stringify(schoolObj))
        this.props.navigate("/admin/classes")
    }

    render() {
        const { schools, errorMessage } = this.state

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
                        { label: "School Selection" }
                    ]}
                    trailingSeparator={true}
                />

                <div className="pageTitle">Admin School Selection</div>

                <div className="main-grid">
                    <div className="container">
                        {errorMessage ? <div className="pageMessage">{errorMessage}</div> : null}

                        <div className="classList">
                            {schools.map((schoolObj: SchoolObject) => (
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
                            ))}
                        </div>

                        {schools.length === 0 && !errorMessage ? (
                            <div className="emptyState">No schools are available yet.</div>
                        ) : null}
                    </div>
                </div>
            </div>
        )
    }
}

export default function AdminSchoolSelect() {
    const navigate = useNavigate()
    return <AdminSchoolSelectInner navigate={navigate} />
}