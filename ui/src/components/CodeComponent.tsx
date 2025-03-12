import { Component } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import { vs } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import 'semantic-ui-css/semantic.min.css';
import Split from 'react-split';
import { Icon } from 'semantic-ui-react';
import React from 'react';


SyntaxHighlighter.registerLanguage('python', python);

interface PylintObject {
    type: string;
    module: string;
    obj: string;
    line: number;
    column: number;
    path: string;
    symbol: string;
    message: string;
    messageid: string;
    reflink: string;
}

interface CodeComponentProps {
    pylintData: Array<PylintObject>;
    codedata: string;
}

class CodeComponent extends Component<CodeComponentProps, {}> {
    constructor(props: CodeComponentProps) {
        super(props);
        this.stylelinenumbers = this.stylelinenumbers.bind(this);
    }

    stylelinenumbers(linenumber: number) {
        for (let index = 0; index < this.props.pylintData.length; index++) {
            const error = this.props.pylintData[index];
            if (error.message.includes("UPPER_CASE")) { 
                continue;
            } else if (error.line === linenumber) {
                return { backgroundColor: 'yellow', color: 'black' };
            }
        }
        return { color: 'black' };
    }

    render() {
        // Workaround to fix TypeScript error with SyntaxHighlighter
        const HighlighterComponent = SyntaxHighlighter as any;

        return (
            <div className="full-height">
                <Split className="split">
                    <div id="code-container">
                        <HighlighterComponent 
                            language="python" 
                            style={vs} 
                            showLineNumbers={true} 
                            lineNumberStyle={this.stylelinenumbers}
                        >
                            {this.props.codedata}
                        </HighlighterComponent>
                    </div>
                    <div id="lint-output">
                        {(() => {
                            const holder = [];
                            for (let index = 0; index < this.props.pylintData.length; index++) {
                                const error = this.props.pylintData[index];
                                if (error.message.includes("UPPER_CASE")) { 
                                    continue;
                                } else if (error.type === "convention") {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <Icon color="black" name='pencil' />
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                } else if (error.type === "refactor") {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <Icon color="blue" name='cogs' />
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                } else if (error.type === "error") {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <Icon color="orange" name='minus circle' />
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                }
                                else if (error.type === "fatal") {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <Icon color="red" name='stop' />
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                }
                                else if (error.type === "warning") {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <Icon color="yellow" name='exclamation triangle' />
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                } else {
                                    holder[index] = ( 
                                        <div key={`error-${index}`}>
                                            <strong>{error.line} : </strong>  
                                            {error.message}
                                            <a href={error.reflink} target="_blank" rel="noreferrer"><strong> (see more)</strong></a>
                                        </div>);
                                }
                            }
                            return holder;
                        })()}
                    </div>
                </Split>
            </div>
        );
    }
}

export default CodeComponent;