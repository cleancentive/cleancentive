import { useEffect } from 'react'
import { useFeedbackStore } from '../stores/feedbackStore'
import { FeedbackPage } from './FeedbackPage'

/**
 * Route handler for /feedback/new — renders the feedback list
 * and auto-opens the feedback modal. Cancelling the modal
 * leaves the user on their "My Feedback" page.
 */
export function FeedbackNew() {
  const { openFeedbackModal } = useFeedbackStore()

  useEffect(() => {
    openFeedbackModal()
  }, [openFeedbackModal])

  return <FeedbackPage />
}
