import React, { useEffect, useState } from "react"
import { Helmet } from "react-helmet"
import axios from "axios"
import MenuComponent from "../components/MenuComponent"
import codeimg from "../../images/codeex.png"
import "../../styling/Classes.scss"
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs"

const ClassSelectionPage: React.FC = () => {
    const [studentClassNames, setstudentClassNames] = useState<Array<string>>([])
    const [studentClassNumbers, setstudentClassNumbers] = useState<Array<string>>([])
    const [addClass, setaddClass] = useState<boolean>(false)
    const [ClassId, setClassId] = useState<string>("")
    const [LectureId, setLectureId] = useState<string>("")
    const [LabId, setLabId] = useState<string>("")

    const handleClassSubmit = (e?: React.FormEvent | React.MouseEvent) => {
        e?.preventDefault?.()

        const formData = new FormData()
        formData.append("class_name", ClassId.toString())
        formData.append("lecture_name", LectureId.toString())
        formData.append("lab_name", LabId.toString())

        axios
            .post(import.meta.env.VITE_API_URL + `/class/add_class_student`, formData, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then(() => {
                window.location.href = "code"
            })
            .catch(() => {
                window.alert("Invalid entry")
                window.location.href = "/class/classes"
            })
    }

    const handleClassIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setClassId(value)
    }

    const handleLectureIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setLectureId(value)
    }

    const handleLabIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value
        setLabId(value)
    }

    useEffect(() => {
        axios
            .get(import.meta.env.VITE_API_URL + `/class/all?filter=true`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                setstudentClassNames([])
                setstudentClassNumbers([])

                res.data.map((obj: { id: number; name: string }) => {
                    setstudentClassNumbers((oldArray) => [...oldArray, obj.id + ""])
                    setstudentClassNames((oldArray) => [...oldArray, obj.name])
                })
            })
    }, [])

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
                    items={[{ label: "Class Selection" }]}
                    trailingSeparator={true}
                />

                <div className="pageTitle">Student Classes</div>

                <div className="main-grid">

                    <div className="container">
                        <div className="classList">
                            {studentClassNames.map((name, index) => (
                                <a
                                    key={index}
                                    href={`/class/${studentClassNumbers[index]}/upload`}
                                    className="clickableRow"
                                >
                                    <div>
                                        <img src={codeimg} alt="Code" />
                                    </div>
                                    <div>
                                        <h1 className="title">{name}</h1>
                                    </div>
                                </a>
                            ))}
                        </div>

                        {addClass && (
                            <form>
                                <div>
                                    <label htmlFor="className">Class Name</label>
                                    <input
                                        id="className"
                                        value={ClassId}
                                        onChange={handleClassIdChange}
                                    />
                                </div>

                                <div>
                                    <label htmlFor="lectureNumber">Lecture Number</label>
                                    <input
                                        id="lectureNumber"
                                        value={LectureId}
                                        onChange={handleLectureIdChange}
                                    />
                                </div>

                                <div>
                                    <label htmlFor="labNumber">Lab Number</label>
                                    <input
                                        id="labNumber"
                                        value={LabId}
                                        onChange={handleLabIdChange}
                                    />
                                </div>

                                <button type="submit" onClick={handleClassSubmit}>
                                    Submit
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default ClassSelectionPage
