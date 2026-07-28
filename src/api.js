import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'
const AUTH_STORE_KEY = 'auth-store'

export function clearStoredAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem(AUTH_STORE_KEY)
}

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json'
  }
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let sessionExpiredPending = false

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !sessionExpiredPending) {
      sessionExpiredPending = true
      clearStoredAuth()
      // Small delay so all in-flight requests settle before redirect
      setTimeout(() => {
        if (window.location.pathname !== '/login') {
          window.location.replace('/login')
        }
      }, 300)
    }
    return Promise.reject(error)
  }
)

export default api
