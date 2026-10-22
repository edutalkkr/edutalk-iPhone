import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  darkMode: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  setDarkMode: (dark: boolean) => void;
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      darkMode: false,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

      toggleDarkMode: () => set((state) => {
        const newMode = !state.darkMode;
        document.documentElement.setAttribute('data-theme', newMode ? 'dark' : 'light');
        return { darkMode: newMode };
      }),
      setDarkMode: (dark: boolean) => {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        set({ darkMode: dark });
      },

      toasts: [],

      addToast: (toast) => {
        const id = crypto.randomUUID();
        const newToast = { ...toast, id };
        set((state) => ({ toasts: [...state.toasts, newToast] }));

        // 자동 제거
        setTimeout(() => {
          get().removeToast(id);
        }, toast.duration || 5000);
      },

      removeToast: (id) => set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      })),
    }),
    {
      name: 'breeze-ui',
      partialize: (state) => ({ sidebarOpen: state.sidebarOpen, darkMode: state.darkMode }),
    }
  )
);