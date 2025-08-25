import { Component } from 'react'
import 'semantic-ui-css/semantic.min.css'
import '../css/CodePage.scss'
import { Form, Modal } from 'semantic-ui-react'
import axios from 'axios'
import ErrorMessage from './ErrorMessage'

interface NewUserModalProps {
    username: string,
    password: string,
    isOpen: boolean
}

interface IdNamePair {
    name: string,
    id: number,
}

interface ClassJson {
    name: string,
    id: number,
    labs: Array<IdNamePair>
    lectures: Array<IdNamePair>
}

interface DropDownOption {
    key: number,
    value: number,
    text: string
}

interface NewUserModalState {
    FirstName: string,
    LastName: string,
    StudentNumber: string,
    Email: string,
    ClassId: number,
    LabId: number,
    LectureId: number,
    classes: Array<ClassJson>,
    hasClassSelected: boolean,
    error_msg: string,
    classOptions: Array<DropDownOption>,
    labOptions: Array<DropDownOption>,
    lectureOptions: Array<DropDownOption>
}

class NewUserModal extends Component<NewUserModalProps, NewUserModalState> {

    constructor(props: any) {
        super(props);

        this.handleFirstNameChange = this.handleFirstNameChange.bind(this);
        this.handleLastNameChange = this.handleLastNameChange.bind(this);
        this.handleEmailChange = this.handleEmailChange.bind(this);
        this.handleStudentNumberChange = this.handleStudentNumberChange.bind(this);
        this.handleClassIdChange = this.handleClassIdChange.bind(this);
        this.handleLabIdChange = this.handleLabIdChange.bind(this);
        this.handleLectureIdChange = this.handleLectureIdChange.bind(this);
        this.handleClick = this.handleClick.bind(this);

        this.state = {
            FirstName: "",
            LastName: "",
            StudentNumber: "",
            Email: "",
            ClassId: -1,
            LabId: -1,
            LectureId: -1,
            classes: [],
            hasClassSelected: false,
            error_msg: "",
            classOptions: [],
            labOptions: [],
            lectureOptions: []
        }
    }

    handleFirstNameChange(ev: React.ChangeEvent<HTMLInputElement>) {
        this.setState({ FirstName: ev.target.value });
    }
    handleLastNameChange(ev: React.ChangeEvent<HTMLInputElement>) {
        this.setState({ LastName: ev.target.value });
    }
    handleEmailChange(ev: React.ChangeEvent<HTMLInputElement>) {
        this.setState({ Email: ev.target.value });
    }
    handleStudentNumberChange(ev: React.ChangeEvent<HTMLInputElement>) {
        this.setState({ StudentNumber: ev.target.value });
    }

    handleClassIdChange(ev: any, value: number) {
        // Find the class
        const selectedClass = this.state.classes.find(cls => cls.id === value);
        // Build lab and lecture options
        const labOptions = selectedClass ? selectedClass.labs.map((lab, i) => ({
            key: lab.id,
            text: lab.name,
            value: lab.id
        })) : [];
        const lectureOptions = selectedClass ? selectedClass.lectures.map((lec, i) => ({
            key: lec.id,
            text: lec.name,
            value: lec.id
        })) : [];
        this.setState({
            ClassId: value,
            LabId: -1,
            LectureId: -1,
            hasClassSelected: value !== -1,
            labOptions,
            lectureOptions
        });
    }

    handleLabIdChange(ev: any, value: number) {
        this.setState({ LabId: value });
    }

    handleLectureIdChange(ev: any, value: number) {
        this.setState({ LectureId: value });
    }

    handleClick(ev: any) {
        ev.preventDefault(); // prevent page reload
        if (this.props.password !== "NAN" && this.props.password !== "NAN") {
            axios.post(import.meta.env.VITE_API_URL + `/auth/create`, {
                password: this.props.password,
                username: this.props.username,
                fname: this.state.FirstName,
                lname: this.state.LastName,
                id: this.state.StudentNumber,
                email: this.state.Email,
                class_id: this.state.ClassId,
                lab_id: this.state.LabId,
                lecture_id: this.state.LectureId
            })
                .then(res => {
                    localStorage.setItem("AUTOTA_AUTH_TOKEN", res.data.access_token);
                    window.location.href = "/class/classes";
                })
                .catch(err => {
                    this.setState({ error_msg: err.response.data.message });
                });
        }
        else {
            axios.post(import.meta.env.VITE_API_URL + `/auth/create_newclass`, {
                password: this.props.password,
                username: this.props.username,
                fname: this.state.FirstName,
                lname: this.state.LastName,
                id: this.state.StudentNumber,
                email: this.state.Email,
                class_id: this.state.ClassId,
                lab_id: this.state.LabId,
                lecture_id: this.state.LectureId
            })
                .then(res => {
                    localStorage.setItem("AUTOTA_AUTH_TOKEN", res.data.access_token);
                    window.location.href = "/class/classes";
                })
                .catch(err => {
                    this.setState({ error_msg: err.response.data.message });
                });
        }
    }

    componentDidMount() {
        axios.get(import.meta.env.VITE_API_URL + `/class/sections`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        })
            .then(res => {
                const classes: Array<ClassJson> = res.data as Array<ClassJson>;
                const classOptions: Array<DropDownOption> = classes.map((cls, idx) => ({
                    key: cls.id,
                    value: cls.id,
                    text: cls.name
                }));
                this.setState({
                    classes,
                    classOptions
                });
            })
            .catch(err => {
                console.log(err);
            });
    }

    render() {
        return (
            <Modal open={this.props.isOpen}>
                <Modal.Header>New User Registration</Modal.Header>
                <Modal.Content>
                    <ErrorMessage isHidden={this.state.error_msg === ""} message={this.state.error_msg}></ErrorMessage>
                    <Form>
                        <Form.Group widths='equal'>
                            <Form.Input fluid label='First name' placeholder='First name' onChange={this.handleFirstNameChange} />
                            <Form.Input fluid label='Last name' placeholder='Last name' onChange={this.handleLastNameChange} />
                        </Form.Group>
                        <Form.Group widths='equal'>
                            <Form.Input fluid label='School ID' placeholder='001234567' onChange={this.handleStudentNumberChange} />
                            <Form.Input fluid label='School Email' placeholder='first.last@marquette.edu' onChange={this.handleEmailChange} />
                        </Form.Group>
                        <Form.Group widths='equal'>
                            <Form.Select
                                fluid
                                label='Class Name'
                                options={this.state.classOptions}
                                placeholder='Class'
                                onChange={(e: any, { value }) => this.handleClassIdChange(e, value ? parseInt(value.toString()) : -1)}
                            />
                            <Form.Select
                                fluid
                                label='Lecture Number'
                                options={this.state.lectureOptions}
                                placeholder='Lecture'
                                onChange={(e: any, { value }) => this.handleLectureIdChange(e, value ? parseInt(value.toString()) : -1)}
                                disabled={!this.state.hasClassSelected}
                            />
                            <Form.Select
                                fluid
                                label='Lab Number'
                                options={this.state.labOptions}
                                placeholder='Lab'
                                onChange={(e: any, { value }) => this.handleLabIdChange(e, value ? parseInt(value.toString()) : -1)}
                                disabled={!this.state.hasClassSelected}
                            />
                        </Form.Group>
                        <Form.Button type="submit" onClick={this.handleClick}>Submit</Form.Button>
                    </Form>
                </Modal.Content>
            </Modal>
        );
    }
}

export default NewUserModal;
