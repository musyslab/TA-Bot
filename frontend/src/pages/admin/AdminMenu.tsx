import { KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet";
import {
    FaChartLine,
    FaChevronRight,
    FaListUl,
    FaUpload,
} from "react-icons/fa";

import MenuComponent from "../components/MenuComponent";
import DirectoryBreadcrumbs from "../components/DirectoryBreadcrumbs";
import "../../styling/Selection.scss";
import "../../styling/AdminMenu.scss";

type AdminMenuOption = {
    title: string;
    description: string;
    to?: string;
    icon: JSX.Element;
    actionLabel: string;
    disabled?: boolean;
};

export default function AdminMenu() {
    const { school_id, class_id } = useParams<{
        school_id: string;
        class_id: string;
    }>();

    const schoolId = school_id || "";
    const classId = class_id || "";

    const moduleListPath = `/admin/school/${schoolId}/class/${classId}/modules`;
    const adminUploadPath = `/admin/school/${schoolId}/class/${classId}/upload`;

    const menuOptions: AdminMenuOption[] = [
        {
            title: "Module List",
            description: "Create, edit, and open class modules",
            to: moduleListPath,
            icon: <FaListUl aria-hidden="true" />,
            actionLabel: "Open Module List",
        },
        {
            title: "Analytics Dashboard",
            description: "View class analytics and performance trends",
            icon: <FaChartLine aria-hidden="true" />,
            actionLabel: "Coming Soon",
            disabled: true,
        },
        {
            title: "Admin Upload",
            description: "Upload and manage admin files for this class",
            to: adminUploadPath,
            icon: <FaUpload aria-hidden="true" />,
            actionLabel: "Open Admin Upload",
        },
    ];

    const handleCardKeyDown = (
        event: KeyboardEvent<HTMLElement>,
        option: AdminMenuOption,
    ) => {
        if (option.disabled || !option.to) return;
        if (event.key !== "Enter" && event.key !== " ") return;

        event.preventDefault();
        window.location.href = option.to;
    };

    return (
        <div className="projects-page admin-landing-root admin-menu-page">
            <Helmet>
                <title>[Admin] MAAT</title>
            </Helmet>

            <MenuComponent
                showUpload={false}
                showAdminUpload={false}
                showHelp={false}
                showCreate={false}
                showLast={false}
                showReviewButton={false}
            />

            <DirectoryBreadcrumbs
                items={[
                    { label: "School Selection", to: "/admin/schools" },
                    {
                        label: "Class Selection",
                        to: schoolId
                            ? `/admin/school/${schoolId}/classes`
                            : "/admin/schools",
                    },
                    { label: "Admin Menu" },
                ]}
                trailingSeparator={true}
            />

            <div className="pageTitle">Admin Menu</div>

            <p className="projects-subtitle">
                Choose where you want to go for this class.
            </p>

            <section className="admin-menu-shell" aria-label="Admin menu">
                <div className="admin-menu-header-row">
                    <div>
                        <h2>Class Admin Options</h2>
                    </div>
                </div>

                <div className="admin-menu-grid">
                    {menuOptions.map((option) => {
                        const cardClasses = [
                            "admin-menu-card",
                            option.disabled ? "is-disabled" : "",
                        ]
                            .join(" ")
                            .trim();

                        const cardContent = (
                            <>
                                <div className="admin-menu-card-main">
                                    <div className="admin-menu-icon">
                                        {option.icon}
                                    </div>

                                    <div className="admin-menu-card-title-row">
                                        <h3>{option.title}</h3>
                                    </div>

                                    <p className="admin-menu-card-description">
                                        {option.description}
                                    </p>
                                </div>

                                <div className="admin-menu-card-actions">
                                    <span
                                        className={`admin-menu-action ${option.disabled
                                            ? "admin-menu-action-secondary admin-menu-disabled-action"
                                            : "admin-menu-action-primary"
                                            }`}
                                    >
                                        {option.actionLabel}
                                        {!option.disabled ? <FaChevronRight aria-hidden="true" /> : null}
                                    </span>
                                </div>
                            </>
                        );

                        if (option.disabled || !option.to) {
                            return (
                                <article
                                    className={cardClasses}
                                    key={option.title}
                                    aria-label={`${option.title} is coming soon`}
                                    aria-disabled="true"
                                >
                                    {cardContent}
                                </article>
                            );
                        }

                        return (
                            <Link
                                className={cardClasses}
                                key={option.title}
                                to={option.to}
                                role="button"
                                onKeyDown={(event) => handleCardKeyDown(event, option)}
                                aria-label={`Open ${option.title}`}
                            >
                                {cardContent}
                            </Link>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}