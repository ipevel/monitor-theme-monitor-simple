import { Component, type ErrorInfo, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { CHUNK_RELOAD_KEY } from "@/lib/reload"

type Props = { children: ReactNode; onReset?: () => void }
type State = { error: Error | null }

/**
 * Catches a failed render below it and offers a way out, so one broken view
 * cannot leave the visitor with a blank page and no explanation.
 *
 * The detail view is code-split, and that is the case this mostly exists for: a
 * theme updated in place leaves older page loads asking for chunk filenames that
 * no longer exist, and the resulting rejection has nothing else to land on.
 * `App` reloads once on that path; this is what shows if the reload does not
 * help either.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render failed", error, info.componentStack)
  }

  private retry = () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    location.reload()
  }

  private back = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="space-y-3 py-16 text-center" role="alert">
        <p className="text-sm text-destructive">这部分没能加载：{error.message || "未知错误"}</p>
        <p className="text-xs text-muted-foreground">
          主题就地更新后，浏览器可能还留着一份旧的页面文件。重新加载一次即可。
        </p>
        <div className="flex justify-center gap-2">
          <Button size="sm" onClick={this.retry}>重新加载</Button>
          <Button size="sm" variant="outline" onClick={this.back}>返回列表</Button>
        </div>
      </div>
    )
  }
}
