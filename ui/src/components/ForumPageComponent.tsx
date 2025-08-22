import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import axios from "axios";
import 'semantic-ui-css/semantic.min.css';
import { Input } from 'semantic-ui-react';

interface ChatProps {
    class_id?: string;
}

const ForumPageComponent = () => {
    const [ClassName, setClassName] = useState<String>("");
    const [thread, setThread] = useState<String>("");
    const [threadBody, setThreadBody] = useState<String>("");

    // handleSubmit creates a new thread on form submission, then resets the thread.
    const handleSubmit = (e: { preventDefault: () => void; }) => {
        // TO DELETE:
        e.preventDefault();
        console.log({ thread });
        console.log({ threadBody });

        // POST EXAMPLE:
        /*
        axios.post(import.meta.env.VITE_API_URL + `/submissions/submit_suggestion`,
            {
                "suggestion": suggestions
            },
            {
                headers:
                {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            }
        ).then(res => {
            alert("Thank you for your constructive feedback, if you have any other suggestions please feel free to submit them.");
        }, (error) => {
            alert("There was an error submitting your feedback. Please try again later.");
        })
            */

        // FILE POST EXAMPLE:
        /*
        if (file !== null) {
            setIsErrorMessageHidden(true);
            setIsLoading(true);
            // Create an object of formData
            const formData = new FormData();

            // Update the formData object
            formData.append(
                "file",
                file,
                file.name
            );

            formData.append("class_id", cid.toString());

            // Request made to the backend api
            // Send formData object
            axios.post(import.meta.env.VITE_API_URL + `/upload/`, formData, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            })
                .then(res => {
                    window.location.href = "code";
                })
                .catch(err => {
                    setError_Message(err.response.data.message);
                    setIsErrorMessageHidden(false);
                    setIsLoading(false);
                })
        }
                */


        /*TODO:
        - Add Forum API paths in app.py
        - Add Forum structure to models.py
        - Create forum_repository.py for forum posts & replies
        - Create forum.py module under src folder to put in injected forum API calls the frontend will use
        */
        axios.post(import.meta.env.VITE_API_URL + '/forum/post',
            {
                "title": thread,
                "body": threadBody,
            },
            {
                headers:
                {
                    'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
                }
            }
        ).then(res => {
            alert("Thank you for submitting your question! Click the new thread to view replies.");
        }, (error) => {
            alert("There was an error submitting your feedback. Please try again later.");
        })

        setThread("");
        setThreadBody("");
    };

    // Get the class ID from state params:
    let { class_id } = useParams<{ class_id: string }>();

    // API call to get the class name from the current ID:
    useEffect(() => {
        axios.get(import.meta.env.VITE_API_URL + `/class/id/` + class_id, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
            }
        }).then(res => {
            res.data.map((obj: { name: string }) => {
                setClassName(obj.name);
            })
        });
    })

    const title = `Class ${ClassName} Discussion Board`;
    //TODO: Add existing threads below with search & sort options
    return (
        <main style={{ margin: "5%" }}>
            <div>
                <h1>{title}</h1>
            </div>
            <div style={{ margin: "2%" }} className="ui raised segment">
                <h2 className="center">Create a Thread</h2>
                <form className="ui form" onSubmit={handleSubmit}>
                    <div className="formInputContainer">
                        <label htmlFor="thread">Question / Thread Title</label>
                        <Input
                            fluid
                            type="text"
                            name="thread"
                            label={{ icon: 'asterisk' }}
                            labelPosition='right corner'
                            placeholder='Is this a good placeholder question?'
                            required
                            value={thread}
                            onChange={(e) => setThread(e.target.value)}
                            style={{ marginBottom: "1%" }}
                        />
                        <label htmlFor="body">Additional Details</label>
                        <textarea
                            name="body"
                            placeholder='Type details clarifying your question here!'
                            value={threadBody as string}
                            onChange={(e) => setThreadBody(e.target.value)}
                        />
                    </div>
                    <button className="ui button" type="submit" style={{ marginTop: "1%" }}>Create Thread</button>
                </form>
            </div>
            <div style={{ margin: "2%" }}>
                <h2>Open Threads</h2>
            </div>
        </main>
    )
}

export default ForumPageComponent