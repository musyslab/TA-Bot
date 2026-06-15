import React from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { Helmet } from 'react-helmet'
import "../../styling/ClassicResultView.scss"


type TestResult = {
    passed: boolean | ''
    skipped: string
    test: {
        name: string
        description: string
        suite?: number
        input?: string
        output?: string
        diff?: string
        locked?: boolean
        hidden?: boolean
    }
}

type ClassicViewPayload = {
    studentName: string
    assignmentLabel: string
    createdAt: string
    expiresAt: string | null
    results: { results: TestResult[] }
}


function StatusBadge({ passed }: { passed: boolean | '' }) {
    if (passed === true)
        return <span className="cvr-badge cvr-badge--pass">PASSED</span>
    if (passed === false)
        return <span className="cvr-badge cvr-badge--fail">NOT PASSED</span>
    return <span className="cvr-badge cvr-badge--unknown">NO OUTPUT</span>
}


function DiffBlock({ diff }: { diff: string }) {
    if (!diff.trim()) return null
    return (
        <pre className="cvr-diff">
            {diff.split('\n').map((line, i) => {
                let cls = 'cvr-diff__line'
                if (line.startsWith('<')) cls += ' cvr-diff__line--expected'
                else if (line.startsWith('>')) cls += ' cvr-diff__line--actual'
                else if (line.startsWith('---')) cls += ' cvr-diff__line--sep'
                return (
                    <span key={i} className={cls}>
                        {line}
                        {'\n'}
                    </span>
                )
            })}
        </pre>
    )
}


function TestRow({ result, index }: { result: TestResult; index: number }) {
    const [open, setOpen] = React.useState(false)
    const hasDiff = Boolean(result.test.diff?.trim())
    const canExpand = result.passed === false && hasDiff

    return (
        <div className={`cvr-row ${result.passed === true ? 'cvr-row--pass' : result.passed === false ? 'cvr-row--fail' : 'cvr-row--unknown'}`}>
            <div
                className="cvr-row__header"
                onClick={() => canExpand && setOpen(o => !o)}
                style={{ cursor: canExpand ? 'pointer' : 'default' }}
                aria-expanded={canExpand ? open : undefined}
            >
                <span className="cvr-row__num">{String(index + 1).padStart(2, '0')}</span>
                <span className="cvr-row__name">{result.test.name}</span>
                {result.test.description && (
                    <span className="cvr-row__group">{result.test.description}</span>
                )}
                <span className="cvr-row__badge">
                    <StatusBadge passed={result.passed} />
                </span>
                {canExpand && (
                    <span className="cvr-row__chevron" aria-hidden>
                        {open ? '▲' : '▼'}
                    </span>
                )}
            </div>

            {open && hasDiff && (
                <div className="cvr-row__body">
                    <p className="cvr-diff__legend">
                        <span className="cvr-diff__swatch cvr-diff__swatch--expected" /> expected &nbsp;
                        <span className="cvr-diff__swatch cvr-diff__swatch--actual" /> your output
                    </p>
                    <DiffBlock diff={result.test.diff!} />
                </div>
            )}
        </div>
    )
}


function SummaryBar({ results }: { results: TestResult[] }) {
    const passed = results.filter(r => r.passed === true).length
    const total = results.length
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0

    return (
        <div className="cvr-summary">
            <div className="cvr-summary__counts">
                <span className="cvr-summary__big">{passed}</span>
                <span className="cvr-summary__slash"> / </span>
                <span className="cvr-summary__total">{total}</span>
                <span className="cvr-summary__label"> tests passed</span>
            </div>
            <div className="cvr-summary__bar-track">
                <div
                    className="cvr-summary__bar-fill"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct}% passed`}
                />
            </div>
        </div>
    )
}


export function ClassicResultView() {
    const { token } = useParams<{ token: string }>()
    const [status, setStatus] = React.useState<'loading' | 'ok' | 'error' | 'expired'>('loading')
    const [payload, setPayload] = React.useState<ClassicViewPayload | null>(null)
    const [errMsg, setErrMsg] = React.useState('')

    React.useEffect(() => {
        if (!token) {
            setStatus('error')
            setErrMsg('No token in URL.')
            return
        }

        axios
            .get(`${import.meta.env.VITE_API_URL}/classic-view/${token}`)
            .then(res => {
                setPayload(res.data)
                setStatus('ok')
            })
            .catch(err => {
                const code = err?.response?.status
                if (code === 410) {
                    setStatus('expired')
                } else {
                    setStatus('error')
                    setErrMsg(
                        err?.response?.data?.error || 'Could not load results.'
                    )
                }
            })
    }, [token])

    const results: TestResult[] = payload?.results?.results ?? []

    return (
        <>
            <Helmet>
                <title>Test Results – TABOT</title>
            </Helmet>

            <div className="cvr-page">
                <header className="cvr-header">
                    <div className="cvr-header__logo">
                        <span className="cvr-header__logo-mark">TA</span>
                        <span className="cvr-header__logo-bot">BOT</span>
                    </div>
                    <div className="cvr-header__titles">
                        {payload?.assignmentLabel && (
                            <h1 className="cvr-header__assignment">
                                {payload.assignmentLabel}
                            </h1>
                        )}
                        {payload?.studentName && (
                            <p className="cvr-header__student">
                                {payload.studentName}
                            </p>
                        )}
                    </div>
                </header>

                <main className="cvr-main">
                    {status === 'loading' && (
                        <div className="cvr-state cvr-state--loading">
                            <div className="cvr-spinner" aria-label="Loading" />
                            <p>Loading your results…</p>
                        </div>
                    )}

                    {status === 'expired' && (
                        <div className="cvr-state cvr-state--expired">
                            <span className="cvr-state__icon">⏰</span>
                            <h2>Link Expired</h2>
                            <p>
                                This results link is no longer active. Contact your
                                instructor or TA if you need to review your submission.
                            </p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="cvr-state cvr-state--error">
                            <span className="cvr-state__icon">⚠️</span>
                            <h2>Results Not Found</h2>
                            <p>{errMsg || 'This link may be invalid or already used.'}</p>
                        </div>
                    )}

                    {status === 'ok' && (
                        <>
                            <SummaryBar results={results} />

                            <section className="cvr-list" aria-label="Test case results">
                                {results.length === 0 ? (
                                    <p className="cvr-empty">
                                        No test case results were recorded for this submission.
                                    </p>
                                ) : (
                                    results.map((r, i) => (
                                        <TestRow key={i} result={r} index={i} />
                                    ))
                                )}
                            </section>

                            {payload?.expiresAt && (
                                <p className="cvr-expiry">
                                    This link is active until{' '}
                                    {new Date(payload.expiresAt).toLocaleString()}.
                                </p>
                            )}
                        </>
                    )}
                </main>
            </div>
        </>
    )
}

export default ClassicResultView