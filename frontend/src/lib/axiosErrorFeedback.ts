import axios from 'axios'
import { useFeedbackStore } from '../stores/feedbackStore'

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status >= 500) {
      useFeedbackStore.getState().openFeedbackModal({
        category: 'bug',
        description: 'A server error occurred.',
        errorContext: {
          url: error.config?.url,
          message: `${error.response.status}: ${error.response.data?.message || error.message}`,
          userAgent: navigator.userAgent,
        },
      })
    }
    return Promise.reject(error)
  },
)
