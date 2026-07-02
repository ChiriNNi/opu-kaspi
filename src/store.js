import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from './api'

export const useStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      users: [],
      loading: false,
      error: null,

      login: async (phone, password) => {
        set({ loading: true, error: null })
        try {
          const res = await api.post('/auth/login', { phone, password })
          set({ token: res.data.token, user: res.data.user })
          localStorage.setItem('token', res.data.token)
          return res.data
        } catch (err) {
          const error = err.response?.data?.error || 'Login failed'
          set({ error })
          throw error
        } finally {
          set({ loading: false })
        }
      },

      setAuth: (token, user) => {
        set({ token, user })
        localStorage.setItem('token', token)
      },

      clearError: () => set({ error: null }),

      logout: async () => {
        // Отписать устройство от push перед выходом, иначе уведы идут после логаута
        try {
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration('/sw.js')
            const sub = reg && await reg.pushManager.getSubscription()
            if (sub) {
              await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } }).catch(() => {})
              await sub.unsubscribe().catch(() => {})
            }
          }
          localStorage.removeItem('push_subscribed')
        } catch {}
        set({ token: null, user: null, users: [] })
        localStorage.removeItem('token')
      },

      checkAuth: async () => {
        const token = localStorage.getItem('token')
        if (!token) return
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          // Set from token immediately so UI renders fast
          set({ token, user: { id: payload.id, phone: payload.phone, role: payload.role, full_name: payload.full_name } })
          // Then fetch fresh role from DB (in case admin changed it)
          const res = await api.get('/auth/me')
          set({ user: { ...res.data.user, password_reset_required: res.data.user.password_reset_required || false } })
        } catch {
          set({ token })
        }
      },

      fetchUsers: async () => {
        set({ loading: true, error: null })
        try {
          const res = await api.get('/users')
          set({ users: res.data.users })
        } catch (err) {
          set({ error: err.response?.data?.error || 'Failed to fetch users' })
        } finally {
          set({ loading: false })
        }
      },

      updateUser: async (id, data) => {
        set({ loading: true, error: null })
        try {
          const res = await api.put(`/users/${id}`, data)
          set((state) => ({
            users: state.users.map((u) => (u.id === id ? res.data.user : u))
          }))
          return res.data
        } catch (err) {
          set({ error: err.response?.data?.error || 'Failed to update user' })
          throw err
        } finally {
          set({ loading: false })
        }
      },

      deleteUser: async (id) => {
        set({ loading: true, error: null })
        try {
          await api.delete(`/users/${id}`)
          set((state) => ({
            users: state.users.filter((u) => u.id !== id)
          }))
        } catch (err) {
          set({ error: err.response?.data?.error || 'Failed to delete user' })
          throw err
        } finally {
          set({ loading: false })
        }
      }
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({ token: state.token, user: state.user })
    }
  )
)
