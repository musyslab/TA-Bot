import { Component } from "react";
import { Helmet } from "react-helmet";
import MenuComponent from "./MenuComponent";

class CriticalErrorPage extends Component {
    render() {
        return (
            <div className="critical-error-page">
                <Helmet>
                    <title>500 Error | TA-Bot</title>
                </Helmet>

                <MenuComponent
                    showAdminUpload={false}
                    showUpload={false}
                    showHelp={false}
                    showCreate={false}
                    showLast={false}
                    showReviewButton={false}
                />

                <div
                    className="critical-error-page__center"
                    style={{ height: "100vh" }}
                >
                    <div className="critical-error-page__content">
                        <img
                            className="critical-error-page__image"
                            src="https://i.ytimg.com/vi/AY-rnBoaiY8/maxresdefault.jpg"
                            alt="Sad robot"
                            height="200px"
                            width="300px"
                        />

                        <h1 className="critical-error-page__title">
                            We&apos;re sorry. AutoTA failed this test.
                        </h1>

                        <p className="critical-error-page__text">
                            A critical error occured when rendering the page.
                        </p>

                        <p className="critical-error-page__text">
                            If this continues to occur, please contact us.
                        </p>
                    </div>
                </div>
            </div>
        );
    }
}

export default CriticalErrorPage;
