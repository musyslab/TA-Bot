import { Component } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
    FaUpload,
    FaHome,
    FaSignInAlt,
    FaSignOutAlt,
} from "react-icons/fa";
import maatLogo from "../../images/MAAT.png";
import "../../styling/MenuComponent.scss";

interface MenuComponentProps {
    showUpload: boolean;
    showAdminUpload: boolean;
    showHelp: boolean;
    showCreate: boolean;
    showReviewButton: boolean;
    showLast: boolean;
}

const getValidStoredToken = (): string | null => {
    const token = localStorage.getItem("AUTOTA_AUTH_TOKEN");

    if (!token) {
        return null;
    }

    const cleanedToken = token.trim();

    if (
        !cleanedToken ||
        cleanedToken.toLowerCase() === "null" ||
        cleanedToken.toLowerCase() === "undefined"
    ) {
        localStorage.removeItem("AUTOTA_AUTH_TOKEN");
        localStorage.removeItem("AUTOTA_USER_ROLE");
        return null;
    }

    return cleanedToken;
};

class MenuComponent extends Component<MenuComponentProps> {
    handleLogout = () => {
        localStorage.removeItem("AUTOTA_AUTH_TOKEN");
        localStorage.removeItem("AUTOTA_USER_ROLE");
        window.location.replace("/login");
    };

    handleLogin = () => {
        window.location.replace("/login");
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

        return role > 0 ? "/admin/schools" : "/student/schools";
    }

    handleDashboard = () => {
        const token = getValidStoredToken();

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
                const path = role > 0 ? "/admin/schools" : "/student/schools";
                window.location.replace(path);
            })
            .catch(() => {
                localStorage.removeItem("AUTOTA_AUTH_TOKEN");
                localStorage.removeItem("AUTOTA_USER_ROLE");
                window.location.replace("/login");
            });
    };

    getClassIdFromUrl(): string | null {
        const nestedMatch = window.location.pathname.match(/^\/student\/school\/\d+\/class\/(\d+)(?:\/|$)/);
        if (nestedMatch) return nestedMatch[1];

        const legacyMatch = window.location.pathname.match(/^\/student\/(\d+)(?:\/|$)/);
        return legacyMatch ? legacyMatch[1] : null;
    }

    render() {
        const classId = this.getClassIdFromUrl();
        const officeHoursPath = classId ? `/student/${classId}/OfficeHours` : "/student/schools";
        const isLoggedIn = Boolean(getValidStoredToken());

        return (
            <nav className="menu menu--top menu--inverted menu--borderless menu--huge">
                <div className="menu__container">
                    <Link className="menu__item menu__item--header" to="/">
                        <img src={maatLogo} alt="MAAT" className="menu__logo" />
                    </Link>

                    {this.props.showAdminUpload && (
                        <>
                            <a className="menu__item" href="/admin/upload">
                                <FaUpload className="menu__icon" aria-hidden="true" />
                                <span className="menu__text">Admin Upload</span>
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