import { Component, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { useFeedbackStore } from '../stores/feedbackStore'

interface Props extends WithTranslation {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryInner extends Component<Props, State> {
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
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>{t('error.title')}</h2>
          <p>{t('error.body')}</p>
          <div className="form-actions">
            <button className="primary-button" onClick={this.handleSendFeedback}>
              {t('error.sendFeedback')}
            </button>
            <button className="secondary-button" onClick={this.handleReload}>
              {t('error.reload')}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export const ErrorBoundary = withTranslation(['shell', 'common'])(ErrorBoundaryInner)
