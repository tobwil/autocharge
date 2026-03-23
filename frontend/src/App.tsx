import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useWebSocket } from './hooks/useWebSocket'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Chargers from './pages/Chargers'
import History from './pages/History'
import Config from './pages/Config'
import Logs from './pages/Logs'

export default function App() {
  const { state, connected } = useWebSocket()

  return (
    <BrowserRouter>
      <Layout connected={connected}>
        <Routes>
          <Route path="/"         element={<Dashboard state={state} />} />
          <Route path="/chargers" element={<Chargers  state={state} />} />
          <Route path="/history"  element={<History />} />
          <Route path="/config"   element={<Config />} />
          <Route path="/logs"     element={<Logs />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
