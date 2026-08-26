import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaClock, FaEye, FaForward, FaInfoCircle, FaTimes } from "react-icons/fa";

import "../../styling/StarSpendingInfo.scss";

export default function StarSpendingInfo() {
    const [isOpen, setIsOpen] = useState(false);
    const titleId = useId();
    const descriptionId = useId();
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const closeDialog = useCallback(() => {
        setIsOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [closeDialog, isOpen]);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className="star-spending-info__trigger"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(true)}
                title="Learn what you can spend stars on"
            >
                <FaInfoCircle aria-hidden="true" />
                <span>Star Uses</span>
            </button>

            {isOpen
                ? createPortal(
                    <div
                        className="star-spending-info__overlay"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) {
                                closeDialog();
                            }
                        }}
                    >
                        <div
                            className="star-spending-info__dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={titleId}
                            aria-describedby={descriptionId}
                        >
                            <div className="star-spending-info__header">
                                <div>
                                    <p className="star-spending-info__eyebrow">Stars</p>
                                    <h2 id={titleId}>What can I spend stars on?</h2>
                                </div>
                                <button
                                    type="button"
                                    className="star-spending-info__close"
                                    onClick={closeDialog}
                                    aria-label="Close star uses"
                                    autoFocus
                                >
                                    <FaTimes aria-hidden="true" />
                                </button>
                            </div>

                            <p id={descriptionId} className="star-spending-info__intro">
                                Stars can be used for optional shortcuts and extra testcase information.
                            </p>

                            <div className="star-spending-info__items">
                                <article className="star-spending-info__item">
                                    <span className="star-spending-info__item-icon" aria-hidden="true">
                                        <FaForward />
                                    </span>
                                    <div>
                                        <h3>Skip a checkpoint</h3>
                                        <p>
                                            Spend stars to skip the next available checkpoint and continue through the module.
                                            Skipped checkpoints do not earn completion stars.
                                        </p>
                                    </div>
                                </article>

                                <article className="star-spending-info__item">
                                    <span className="star-spending-info__item-icon" aria-hidden="true">
                                        <FaClock />
                                    </span>
                                    <div>
                                        <h3>Skip a submission cooldown</h3>
                                        <p>
                                            If a submission is in its cooldown period, spend stars to remove the timer and submit again immediately.
                                        </p>
                                    </div>
                                </article>

                                <article className="star-spending-info__item">
                                    <span className="star-spending-info__item-icon" aria-hidden="true">
                                        <FaEye />
                                    </span>
                                    <div>
                                        <h3>Reveal a testcase</h3>
                                        <p>
                                            After a testcase fails, spend stars to reveal that testcase input so you can better understand the failure.
                                        </p>
                                    </div>
                                </article>
                            </div>

                            <p className="star-spending-info__note">
                                The number of stars required can vary by the action and by whether you are working on a checkpoint or main project.
                            </p>
                        </div>
                    </div>,
                    document.body,
                )
                : null}
        </>
    );
}
