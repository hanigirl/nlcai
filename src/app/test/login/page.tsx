/**
 * The real sign-in screen, reviewable while signed in (/login sends a
 * signed-in user home). Local dev only — middleware keeps /test/* behind
 * auth in production. Clicking "שכחתי סיסמא" here really sends the email.
 */
import LoginPage from "@/app/login/page"

export default function LoginPreviewPage() {
  return <LoginPage />
}
