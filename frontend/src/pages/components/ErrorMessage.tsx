import { Component } from "react";

interface ErrorMessageProps {
  message: string;
  isHidden: boolean;
}

class ErrorMessage extends Component<ErrorMessageProps> {
  render() {
    const { message, isHidden } = this.props;

    if (isHidden || !message) return null;

    return (
      <div role="alert" aria-live="assertive" className="error-message">
        {message}
      </div>
    );
  }
}

export default ErrorMessage;
