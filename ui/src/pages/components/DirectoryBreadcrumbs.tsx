import React from "react"
import { Link } from "react-router-dom"
import "../../styling/Directory.scss"

export type DirectoryCrumb = {
    label: string
    to?: string
}

interface DirectoryBreadcrumbsProps {
    items: DirectoryCrumb[]
    trailingSeparator?: boolean // true => "Class Selection/"
    className?: string
}

const DirectoryBreadcrumbs: React.FC<DirectoryBreadcrumbsProps> = ({
    items,
    trailingSeparator = false,
    className = "",
}) => {
    return (
        <nav className={`directory ${className}`.trim()} aria-label="Directory">
            <ol className="directory__list">
                {items.map((item, idx) => {
                    const isLast = idx === items.length - 1
                    const showSeparator = !isLast || trailingSeparator

                    const content =
                        item.to && !isLast ? (
                            <Link className="directory__link" to={item.to}>
                                {item.label}
                            </Link>
                        ) : (
                            <span className="directory__current">{item.label}</span>
                        )

                    return (
                        <li key={`${item.label}-${idx}`} className="directory__item">
                            {content}
                            {showSeparator && <span className="directory__sep">/</span>}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

export default DirectoryBreadcrumbs
