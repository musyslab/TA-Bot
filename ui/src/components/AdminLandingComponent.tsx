import { Component } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import codeimg from '../codeex.png'
import styles from '../css/AdminLandingComponent.module.scss'

interface ClassObject {
    Id: number;
    Name: string;
}

interface ClassState {
    classes: Array<ClassObject>;
}

class AdminComponent extends Component<{}, ClassState> {
    constructor(props: {}) {
        super(props);
        this.state = {
            classes: []
        };
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
                );

                classes.sort((a: ClassObject, b: ClassObject) =>
                    a.Name.localeCompare(b.Name)
                );

                this.setState({ classes });
            })
            .catch(err => {
                console.error(err);
            });
    }

    render() {
        const { classes } = this.state;

        return (
            <div className={styles.adminContainer}>
                <div className={styles.sectionTitle}>Teacher Classes</div>

                <div className={styles.classList}>
                    {classes.map((classObj: ClassObject) => (
                        <Link
                            key={classObj.Id}
                            to={`/admin/projects/${classObj.Id}`}
                            className={styles.clickableRow}
                        >
                            <div>
                                <img src={codeimg} alt="Code" />
                            </div>
                            <div>
                                <h1 className={styles.title}>{classObj.Name}</h1>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        );
    }
}

export default AdminComponent;
