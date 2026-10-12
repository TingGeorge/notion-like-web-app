import { Toaster } from '../ui/toast'
import { t } from '../strings/zh-TW'

export function App() {
  return (
    <>
      <main style={{ padding: 40 }}>
        <h1>{t.app.name}</h1>
      </main>
      <Toaster />
    </>
  )
}
