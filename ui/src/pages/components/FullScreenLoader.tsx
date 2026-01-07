import React from 'react'
import '../../styling/FullScreenLoader.scss'

type FullScreenLoaderProps = {
    show: boolean
    message?: string
}

export default function FullScreenLoader({ show, message }: FullScreenLoaderProps) {
    if (!show) return null

    return (
        <div className="fullscreen-loader-overlay" role="status" aria-live="polite" aria-busy="true">
            <div className="fullscreen-loader-panel">
                <div className="fullscreen-loader-spinner" aria-hidden="true" />
                <div className="fullscreen-loader-text">{message || 'Loading...'}</div>
            </div>
        </div>
    )
}
