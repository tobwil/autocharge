import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'

const NAV = [
  { path: '/', label: 'Dashboard', icon: '⚡' },
  { path: '/chargers', label: 'Ladepunkte', icon: '🔌' },
  { path: '/history', label: 'Verlauf', icon: '📊' },
  { path: '/config', label: 'Einstellungen', icon: '⚙️' },
  { path: '/logs', label: 'Logs', icon: '🖥' },
]

interface Props {
  connected: boolean
  children: React.ReactNode
}

export default function Layout({ connected, children }: Props) {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [shutting, setShutting] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  async function shutdown() {
    if (!confirm('App wirklich beenden?')) return
    setShutting(true)
    await fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      <header className="sticky top-0 z-40 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-900 shadow-sm dark:shadow-none">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">

          {/* Brand + status */}
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">⚡ AutoCharge</span>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>

          {/* Nav */}
          <nav className="flex gap-1">
            {NAV.map(n => (
              <NavLink
                key={n.path}
                to={n.path}
                end={n.path === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`
                }
              >
                <span className="mr-1">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>

          {/* Dark mode + Shutdown */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDark(d => !d)}
              className="px-2.5 py-1.5 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title={dark ? 'Hell-Modus' : 'Dunkel-Modus'}
            >
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              onClick={shutdown}
              disabled={shutting}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
              title="App beenden"
            >
              {shutting ? '⏹ …' : '⏹ Beenden'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
