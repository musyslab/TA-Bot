import React from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { Helmet } from 'react-helmet'
import '../../styling/ClassicResultView.scss'

type TestResult = {
    passed: boolean | ''
    skipped: string
    test: {
        name?: string
        description?: string
        category?: string
        comment?: string
        suite?: number
        input?: string
        output?: string
        expected?: string
        actual?: string
        diff?: string
        message?: string
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

function isCompilationFailure(results: TestResult[]): boolean {
    return (
        results.length === 1 &&
        results[0].passed === false &&
        results[0].test.name === 'compilation'
    )
}

function formatTimestamp(iso: string): string {
    if (!iso) return ''
    try {
        return new Date(iso).toLocaleString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return iso
    }
}

function StatusBadge({ passed }: { passed: boolean | '' }) {
    if (passed === true)
        return <span className="cvr-badge cvr-badge--pass">PASSED</span>
    if (passed === false)
        return <span className="cvr-badge cvr-badge--fail">NOT PASSED</span>
    return <span className="cvr-badge cvr-badge--unknown">NO OUTPUT</span>
}

function CompilationBanner({ result }: { result: TestResult }) {
    const message = result.test.message || 'Compilation failed. See the attached .txt file for details.'
    return (
        <div className="cvr-compile-banner">
            <div className="cvr-compile-banner__icon">✗</div>
            <div className="cvr-compile-banner__body">
                <p className="cvr-compile-banner__title">Compilation Failed</p>
                <p className="cvr-compile-banner__message">{message}</p>
            </div>
        </div>
    )
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

function OutputGrid({ expected, actual }: { expected?: string; actual?: string }) {
    if (!expected && !actual) return null
    return (
        <div className="cvr-output-grid">
            {expected !== undefined && (
                <div className="cvr-output-block cvr-output-block--expected">
                    <div className="cvr-output-block__label">Expected output</div>
                    <pre className="cvr-output-block__content">{expected}</pre>
                </div>
            )}
            {actual !== undefined && (
                <div className="cvr-output-block cvr-output-block--actual">
                    <div className="cvr-output-block__label">Your output</div>
                    <pre className="cvr-output-block__content">{actual}</pre>
                </div>
            )}
        </div>
    )
}

function TestRow({
    result,
    index,
}: {
    result: TestResult
    index: number
}) {
    const [open, setOpen] = React.useState(false)
    const hasDiff = Boolean(result.test.diff?.trim())
    const hasOutput = Boolean(result.test.expected || result.test.actual)
    const canExpand = result.passed === false && (hasDiff || hasOutput)

    return (
        <div className={`cvr-row ${result.passed === true ? 'cvr-row--pass' : result.passed === false ? 'cvr-row--fail' : 'cvr-row--unknown'}`}>
            <div
                className="cvr-row__header"
                onClick={() => canExpand && setOpen(o => !o)}
                style={{ cursor: canExpand ? 'pointer' : 'default' }}
                aria-expanded={canExpand ? open : undefined}
            >
                <span className="cvr-row__num">{String(index + 1).padStart(2, '0')}</span>
                <span className="cvr-row__name">{result.test.name ?? `Test ${index + 1}`}</span>
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

            {open && (
                <div className="cvr-row__body">
                    {hasOutput && (
                        <OutputGrid
                            expected={result.test.expected}
                            actual={result.test.actual}
                        />
                    )}
                    {hasDiff && (
                        <>
                            <p className="cvr-diff__legend">
                                <span className="cvr-diff__swatch cvr-diff__swatch--expected" /> expected &nbsp;
                                <span className="cvr-diff__swatch cvr-diff__swatch--actual" /> your output
                            </p>
                            <DiffBlock diff={result.test.diff!} />
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

type CategoryGroup = {
    category: string
    comment: string
    results: TestResult[]
}

function groupByCategory(results: TestResult[]): CategoryGroup[] {
    const order: string[] = []
    const map = new Map<string, CategoryGroup>()

    for (const r of results) {
        const cat = r.test.category?.trim() || 'Other'
        const comment = r.test.comment?.trim() || ''
        if (!map.has(cat)) {
            order.push(cat)
            map.set(cat, { category: cat, comment, results: [] })
        }
        const group = map.get(cat)!
        if (!group.comment && comment) group.comment = comment
        group.results.push(r)
    }

    return order.map(category => map.get(category)!)
}

function CategorySection({
    group,
    startIndex,
}: {
    group: CategoryGroup
    startIndex: number
}) {
    const [collapsed, setCollapsed] = React.useState(false)
    const passed = group.results.filter(r => r.passed === true).length
    const total = group.results.length
    const allPass = passed === total
    const anyFail = passed < total

    return (
        <section className={`cvr-category ${allPass ? 'cvr-category--pass' : anyFail ? 'cvr-category--fail' : ''} ${collapsed ? 'cvr-category--collapsed' : ''}`}>
            <div
                className="cvr-category__header"
                onClick={() => setCollapsed(c => !c)}
                style={{ cursor: 'pointer' }}
                aria-expanded={!collapsed}
            >
                <div className="cvr-category__header-left">
                    <h2 className="cvr-category__title">{group.category}</h2>
                    {group.comment && (
                        <span className="cvr-category__comment">{group.comment}</span>
                    )}
                </div>
                <div className="cvr-category__header-right">
                    <span className={`cvr-category__count ${allPass ? 'cvr-category__count--pass' : 'cvr-category__count--fail'}`}>
                        {passed} / {total}
                    </span>
                    <span className="cvr-category__chevron" aria-hidden>
                        {collapsed ? '▶' : '▼'}
                    </span>
                </div>
            </div>
            {!collapsed && (
                <div className="cvr-list">
                    {group.results.map((r, i) => (
                        <TestRow
                            key={i}
                            result={r}
                            index={startIndex + i}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}

function SummaryBar({
    results,
    groups,
    createdAt,
}: {
    results: TestResult[]
    groups: CategoryGroup[]
    createdAt: string
}) {
    const passed = results.filter(r => r.passed === true).length
    const total = results.length
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0

    return (
        <div className="cvr-summary">
            <div className="cvr-summary__top">
                <div className="cvr-summary__counts">
                    <span className="cvr-summary__big">{passed}</span>
                    <span className="cvr-summary__slash"> / </span>
                    <span className="cvr-summary__total">{total}</span>
                    <span className="cvr-summary__label"> tests passed</span>
                </div>
            </div>

            <div className="cvr-summary__bar-track">
                <div
                    className="cvr-summary__bar-fill"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct}% passed`}
                />
            </div>

            {/* Per-category breakdown */}
            {groups.length > 1 && (
                <div className="cvr-summary__breakdown">
                    {groups.map((group, i) => {
                        const gPassed = group.results.filter(r => r.passed === true).length
                        const gTotal = group.results.length
                        const gAllPass = gPassed === gTotal
                        return (
                            <div key={i} className={`cvr-summary__cat ${gAllPass ? 'cvr-summary__cat--pass' : 'cvr-summary__cat--fail'}`}>
                                <span className="cvr-summary__cat-name">{group.category}</span>
                                <span className="cvr-summary__cat-score">{gPassed}/{gTotal}</span>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Graded timestamp */}
            {createdAt && (
                <p className="cvr-summary__timestamp">
                    Graded on {formatTimestamp(createdAt)}
                </p>
            )}
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
    const groups = React.useMemo(() => groupByCategory(results), [results])
    const compilationFailed = isCompilationFailure(results)

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
                            {compilationFailed ? (
                                <>
                                    <CompilationBanner result={results[0]} />
                                    {payload?.createdAt && (
                                        <p className="cvr-summary__timestamp cvr-summary__timestamp--standalone">
                                            Graded on {formatTimestamp(payload.createdAt)}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <>
                                    <SummaryBar
                                        results={results}
                                        groups={groups}
                                        createdAt={payload?.createdAt ?? ''}
                                    />

                                    {results.length === 0 ? (
                                        <p className="cvr-empty">
                                            No test case results were recorded for this submission.
                                        </p>
                                    ) : (
                                        (() => {
                                            let runningIndex = 0
                                            return groups.map((group, gi) => {
                                                const startIndex = runningIndex
                                                runningIndex += group.results.length
                                                return (
                                                    <CategorySection
                                                        key={gi}
                                                        group={group}
                                                        startIndex={startIndex}
                                                    />
                                                )
                                            })
                                        })()
                                    )}
                                </>
                            )}

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