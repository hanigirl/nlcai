import { Component, type ReactNode } from 'react'

// A shader is decoration. If WebGPU throws somewhere we didn't foresee — a browser
// whose implementation differs from Chrome's, as Safari's did with the ResizeObserver
// box — the effect disappears and the page goes on, instead of the throw climbing to
// the route's error boundary and replacing the whole screen with the error page.
export class ShaderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('Shader effect crashed; rendering without it', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
