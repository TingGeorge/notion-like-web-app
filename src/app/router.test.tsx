// @vitest-environment happy-dom
import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useRoute } from './router'

describe('useRoute', () => {
  it('answers the same route object while the hash stays empty', async () => {
    history.replaceState(null, '', location.pathname)
    expect(location.hash).toBe('')
    let renders = 0
    function Probe() {
      const route = useRoute()
      // A subscriber that re-renders on every change, like the app shell.
      useEffect(() => {}, [route])
      renders++
      return <span>{route.name}</span>
    }
    const { container } = render(<Probe />)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(container.textContent).toBe('home')
    expect(renders).toBeLessThan(5)
  })
})
