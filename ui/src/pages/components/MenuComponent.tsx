import { Component } from "react";
import axios from "axios";
import { FaUpload, FaClock, FaClipboardList, FaSignOutAlt } from "react-icons/fa";
import "../../styling/MenuComponent.scss";

interface MenuComponentProps {
    showUpload: boolean;
    showAdminUpload: boolean;
    showHelp: boolean;
    showCreate: boolean;
    showReviewButton: boolean;
    showLast: boolean;
}

class MenuComponent extends Component<MenuComponentProps> {
    // Logout and redirect
    handleLogout = () => {
        localStorage.removeItem("AUTOTA_AUTH_TOKEN");
        window.location.replace("/login");
    };

    // Home routing based on role
    handleHome = () => {
        axios
            .get(`${import.meta.env.VITE_API_URL}/auth/get-role`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
                },
            })
            .then((res) => {
                const role = parseInt(res.data, 10);
                const path = role === 1 ? "/admin/classes" : "/student/classes";
                window.location.replace(path);
            });
    };

    // Compute dynamic class upload ID (more general: any /class/:id/... path)
    getClassIdFromUrl(): string | null {
        const match = window.location.href.match(/\/student\/(\d+)/);
        return match ? match[1] : null;
    }

    render() {
        const classId = this.getClassIdFromUrl();
        const officeHoursPath = classId ? `/student/${classId}/OfficeHours` : "/student/classes";

        return (
            <nav className="menu menu--top menu--inverted menu--borderless menu--huge">
                <div className="menu__container">
                    <button type="button" className="menu__item menu__item--header" onClick={this.handleHome}>
                        TA-Bot
                    </button>

                    {this.props.showAdminUpload && (
                        <>
                            <a className="menu__item" href="/admin/upload">
                                <FaUpload className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Admin Upload</span>
                            </a>

                            <a className="menu__item" href="/admin/OfficeHours">
                                <FaClock className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Office Hours</span>
                            </a>
                        </>
                    )}

                    {this.props.showLast && (
                        <>
                            <a className="menu__item" href={officeHoursPath}>
                                <FaClock className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Office Hours</span>
                            </a>

                            <a className="menu__item" href="/student/PastSubmissions">
                                <FaClipboardList className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Submissions</span>
                            </a>
                        </>
                    )}

                    <div className="menu__right">
                        <button
                            type="button"
                            className="menu__item menu__item--link menu__logout"
                            onClick={this.handleLogout}
                            title="Log Out"
                        >
                            <FaSignOutAlt className="menu__icon" aria-hidden="true" />
                            <span className="menu__text">Log Out</span>
                        </button>
                    </div>
                </div>
            </nav>
        );
    }
}

export default MenuComponent;
