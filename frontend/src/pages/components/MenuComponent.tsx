import { Component } from "react";
import axios from "axios";
import {
    FaUpload,
    FaClock,
    FaClipboardList,
    FaHome,
    FaSignInAlt,
    FaSignOutAlt,
} from "react-icons/fa";
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
    handleLogout = () => {
        localStorage.removeItem("AUTOTA_AUTH_TOKEN");
        localStorage.removeItem("AUTOTA_USER_ROLE");
        window.location.replace("/login");
    };

    handleLogin = () => {
        window.location.replace("/login");
    };

    handleHome = () => {
        window.location.replace("/");
    };

    getStoredDashboardPath(): string | null {
        const storedRole = localStorage.getItem("AUTOTA_USER_ROLE");

        if (storedRole === null) {
            return null;
        }

        const role = parseInt(storedRole, 10);

        if (Number.isNaN(role)) {
            return null;
        }

        return role === 1 ? "/admin/classes" : "/student/classes";
    }

    handleDashboard = () => {
        const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

        if (!token) {
            window.location.replace("/login");
            return;
        }

        const storedPath = this.getStoredDashboardPath();
        if (storedPath) {
            window.location.replace(storedPath);
            return;
        }

        axios
            .get(`${import.meta.env.VITE_API_URL}/auth/get-role`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            })
            .then((res) => {
                const role = parseInt(res.data, 10);
                localStorage.setItem("AUTOTA_USER_ROLE", String(role));
                const path = role === 1 ? "/admin/classes" : "/student/classes";
                window.location.replace(path);
            })
            .catch(() => {
                localStorage.removeItem("AUTOTA_AUTH_TOKEN");
                localStorage.removeItem("AUTOTA_USER_ROLE");
                window.location.replace("/login");
            });
    };

    getClassIdFromUrl(): string | null {
        const match = window.location.href.match(/\/student\/(\d+)/);
        return match ? match[1] : null;
    }

    render() {
        const classId = this.getClassIdFromUrl();
        const officeHoursPath = classId ? `/student/${classId}/OfficeHours` : "/student/classes";
        const isLoggedIn = Boolean(localStorage.getItem("AUTOTA_AUTH_TOKEN"));

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
                                <span className="menu__text">Past Submissions</span>
                            </a>
                        </>
                    )}

                    <div className="menu__right">
                        {isLoggedIn ? (
                            <>
                                <button
                                    type="button"
                                    className="menu__item menu__item--link"
                                    onClick={this.handleDashboard}
                                    title="Dashboard"
                                >
                                    <FaHome className="menu__icon" aria-hidden="true" />
                                    <span className="menu__text">Dashboard</span>
                                </button>

                                <button
                                    type="button"
                                    className="menu__item menu__item--link menu__logout"
                                    onClick={this.handleLogout}
                                    title="Log Out"
                                >
                                    <FaSignOutAlt className="menu__icon" aria-hidden="true" />
                                    <span className="menu__text">Log Out</span>
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="menu__item menu__item--link"
                                onClick={this.handleLogin}
                                title="Log In"
                            >
                                <FaSignInAlt className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Log In</span>
                            </button>
                        )}
                    </div>
                </div>
            </nav>
        );
    }
}

export default MenuComponent;