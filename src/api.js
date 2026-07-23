import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

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
      localStorage.removeItem('token')
      // Small delay so all in-flight requests settle before redirect
      setTimeout(() => { window.location.href = '/login' }, 300)
    }
    return Promise.reject(error)
  }
)

export default api
