import { create } from 'zustand';

type AppState = { ready: boolean; onboarded: boolean; theme: 'light' | 'dark' | 'system'; setReady: (ready: boolean) => void; setOnboarded: (onboarded: boolean) => void; setTheme: (theme: AppState['theme']) => void };
export const useAppStore = create<AppState>((set) => ({ ready: false, onboarded: false, theme: 'system', setReady: (ready) => set({ ready }), setOnboarded: (onboarded) => set({ onboarded }), setTheme: (theme) => set({ theme }) }));
