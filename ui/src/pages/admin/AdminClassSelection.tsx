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

interface ClassState {
    classes: Array<ClassObject>
}

class AdminClassSelection extends Component<{}, ClassState> {
    constructor(props: {}) {
        super(props)
        this.state = {
            classes: []
        }
    }

    componentDidMount() {
        axios
            .get(import.meta.env.VITE_API_URL + `/class/all?filter=true`, {
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

                this.setState({ classes })
            })
            .catch(err => {
                console.error(err)
            })
    }

    render() {
        const { classes } = this.state

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
                    items={[{ label: "Class Selection" }]}
                    trailingSeparator={true}
                />

                <div className="pageTitle">Admin Classes</div>

                <div className="main-grid">
                    <div className="container">

                        <div className="classList">
                            {classes.map((classObj: ClassObject) => (
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
                    </div>
                </div>
            </div>
        )
    }
}

export default AdminClassSelection