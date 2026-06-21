import axios from 'axios'
import i18n from '../i18n'

// Forward the active UI locale to the backend on every request, so
// server-rendered content (labels, emails, error messages) matches the
// language the user is seeing — even for guests with no stored profile.
axios.interceptors.request.use((config) => {
  const lng = i18n.resolvedLanguage || i18n.language
  if (lng) {
    config.headers = config.headers ?? {}
    config.headers['Accept-Language'] = lng
  }
  return config
})
