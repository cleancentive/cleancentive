import { Component, type ReactNode } from 'react'
import { useFeedbackStore } from '../stores/feedbackStore'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleSendFeedback = () => {
    const { error } = this.state
    useFeedbackStore.getState().openFeedbackModal({
      category: 'bug',
      description: `An unexpected error occurred: ${error?.message || 'Unknown error'}`,
      errorContext: {
        url: window.location.href,
        message: error?.message,
        stack: error?.stack,
        userAgent: navigator.userAgent,
      },
    })
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>An unexpected error occurred. You can send feedback to help us fix it.</p>
          <div className="form-actions">
            <button className="primary-button" onClick={this.handleSendFeedback}>
              Send Feedback
            </button>
            <button className="secondary-button" onClick={this.handleReload}>
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
