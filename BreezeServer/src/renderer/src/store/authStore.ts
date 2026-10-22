import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Teacher } from '@shared/types';

interface AuthState {
  token: string | null;
  teacher: Teacher | null;
  isAuthenticated: boolean;
  setAuth: (token: string, teacher: Teacher) => void;
  clearAuth: () => void;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const API_BASE = '/api';

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      teacher: null,
      isAuthenticated: false,

      setAuth: (token: string, teacher: Teacher) => {
        set({ token, teacher, isAuthenticated: true });
      },

      clearAuth: () => {
        set({ token: null, teacher: null, isAuthenticated: false });
      },

      checkAuth: async () => {
        const token = get().token;
        if (!token) return;

        try {
          const response = await fetch(`${API_BASE}/auth/verify`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              set({ teacher: data.teacher, isAuthenticated: true });
              return;
            }
          }
        } catch (error) {
          console.error('Auth check failed:', error);
        }

        // 인증 실패 시 토큰 제거
        get().clearAuth();
      },

      logout: async () => {
        const token = get().token;
        if (token) {
          try {
            await fetch(`${API_BASE}/auth/logout`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (error) {
            console.error('Logout failed:', error);
          }
        }
        get().clearAuth();
      },
    }),
    {
      name: 'breeze-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
);