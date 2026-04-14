"use client";

import { createClient } from "@/lib/supabase/client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import logoNew from "../../../images/logo-new.png";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type FieldErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
};

type Message = {
  text: string;
  type: "error" | "success";
};

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getHebrewError(errorMessage: string): string {
  if (errorMessage.includes("Invalid login credentials")) {
    return "המייל או הסיסמא שהזנת לא נכונים";
  }
  if (errorMessage.includes("Email not confirmed")) {
    return "המייל עדיין לא אומת. בדקי את תיבת המייל שלך";
  }
  if (errorMessage.includes("User already registered")) {
    return "כבר קיים חשבון עם המייל הזה. נסי להתחבר";
  }
  if (errorMessage.includes("Email rate limit exceeded") || errorMessage.includes("rate limit")) {
    return "יותר מדי ניסיונות. נסי שוב בעוד כמה דקות";
  }
  if (errorMessage.includes("Password should be at least")) {
    return "הסיסמא צריכה להכיל לפחות 6 תווים";
  }
  return "משהו השתבש. נסי שוב";
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Default to login (returning users). Callers can force signup via ?mode=signup.
  const [isSignUp, setIsSignUp] = useState(() => searchParams.get("mode") === "signup");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const supabase = createClient();

  // Show informative message if callback returned an auth error
  useEffect(() => {
    if (searchParams.get("error") === "auth") {
      setIsSignUp(false);
      setMessage({
        text: "הקישור לא תקף יותר (אולי כבר לחצת עליו, או שפג תוקפו). נסי להתחבר, ואם צריך — נשלח מייל חדש.",
        type: "error",
      });
    }
  }, [searchParams]);

  function validateFields(): boolean {
    const errors: FieldErrors = {};

    if (isSignUp) {
      if (!firstName.trim()) errors.firstName = "חובה להזין שם פרטי";
      if (!lastName.trim()) errors.lastName = "חובה להזין שם משפחה";
    }

    if (!email.trim()) {
      errors.email = "חובה להזין מייל";
    } else if (!validateEmail(email)) {
      errors.email = "כתובת מייל לא תקינה";
    }

    if (!password) {
      errors.password = "חובה להזין סיסמא";
    } else if (password.length < 6) {
      errors.password = "הסיסמא צריכה להכיל לפחות 6 תווים";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (!validateFields()) return;

    setLoading(true);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: `${firstName} ${lastName}`.trim(),
          },
        },
      });

      // Supabase quirk: signUp for an existing UNCONFIRMED user returns 200 with
      // data.user populated but identities=[]. In that case we resend the confirmation.
      const userExistsUnconfirmed = !error && data?.user && data.user.identities && data.user.identities.length === 0;
      if (userExistsUnconfirmed) {
        const { error: resendErr } = await supabase.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (resendErr) {
          setMessage({ text: getHebrewError(resendErr.message), type: "error" });
        } else {
          setMessage({
            text: "שלחנו לך מייל אימות חדש. בדקי את תיבת המייל שלך (גם בספאם)",
            type: "success",
          });
        }
      } else if (error) {
        // If already fully registered (confirmed), nudge them to resend or login
        if (error.message.includes("User already registered")) {
          const { error: resendErr } = await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
          if (!resendErr) {
            setMessage({
              text: "נראה שכבר נרשמת. שלחנו לך מייל אימות חדש — אם הוא לא מגיע, נסי להתחבר במקום.",
              type: "success",
            });
          } else {
            setMessage({ text: getHebrewError(error.message), type: "error" });
          }
        } else {
          setMessage({ text: getHebrewError(error.message), type: "error" });
        }
      } else {
        setMessage({
          text: "שלחנו לך מייל אימות. בדקי את תיבת המייל שלך (גם בספאם) כדי להשלים את ההרשמה",
          type: "success",
        });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setMessage({ text: getHebrewError(error.message), type: "error" });
      } else {
        window.location.href = "/";
      }
    }

    setLoading(false);
  }

  async function handleGoogleLogin() {
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setMessage({ text: "ההתחברות עם Google נכשלה. נסי שוב", type: "error" });
    }
  }

  return (
    <div dir="rtl" className="flex min-h-screen">
      {/* Right side - form */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-1/2">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center">
          <Image
            src={logoNew}
            alt="Next Level Content AI"
            className="h-[86px] w-auto"
            priority
          />
        </div>

        {/* Card */}
        <Card className="w-full max-w-md border-border-neutral-default rounded-3xl">
          <CardHeader className="items-center pb-2">
            <CardTitle className="text-2xl text-text-primary-default text-center">
              {isSignUp ? "וולקאם לנקסט לבל של התכנים שלך" : "טוב לראות אותך שוב..."}
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              {isSignUp && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="text"
                      placeholder="שם פרטי *"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        if (fieldErrors.firstName) setFieldErrors((prev) => ({ ...prev, firstName: undefined }));
                      }}
                      aria-invalid={!!fieldErrors.firstName}
                    />
                    {fieldErrors.firstName && (
                      <p className="mt-1 text-xs text-button-destructive-default">{fieldErrors.firstName}</p>
                    )}
                  </div>
                  <div className="flex-1">
                    <Input
                      type="text"
                      placeholder="שם משפחה *"
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        if (fieldErrors.lastName) setFieldErrors((prev) => ({ ...prev, lastName: undefined }));
                      }}
                      aria-invalid={!!fieldErrors.lastName}
                    />
                    {fieldErrors.lastName && (
                      <p className="mt-1 text-xs text-button-destructive-default">{fieldErrors.lastName}</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <Input
                  type="email"
                  placeholder="מייל *"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.email}
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-button-destructive-default">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <Input
                  type="password"
                  placeholder="סיסמא *"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  aria-invalid={!!fieldErrors.password}
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-button-destructive-default">{fieldErrors.password}</p>
                )}
              </div>

              <Button type="submit" disabled={loading} className="w-full h-12 rounded-xl">
                {loading
                  ? "טוען..."
                  : isSignUp
                    ? "הרשמה"
                    : "כניסה לחשבון"}
              </Button>
            </form>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border-neutral-default" />
              <span className="text-small text-text-neutral-default">או</span>
              <div className="h-px flex-1 bg-border-neutral-default" />
            </div>

            {/* Google button */}
            <Button
              variant="outline"
              onClick={handleGoogleLogin}
              className="w-full h-12 rounded-xl border-border-neutral-default text-text-primary-default"
            >
              <svg className="size-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.56-2.77.01-.54z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {isSignUp ? "הרשמה עם Google" : "כניסה עם Google"}
            </Button>

            {/* Message */}
            {message && (
              <div
                className={`mt-4 rounded-xl px-4 py-3 text-center text-sm ${
                  message.type === "error"
                    ? "bg-red-95 text-button-destructive-default"
                    : "bg-bg-surface-primary-default text-text-primary-default"
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Toggle sign up / sign in */}
            <p className="mt-6 text-center text-small text-text-neutral-default">
              {isSignUp ? "כבר יש לך חשבון?" : "אין לך חשבון?"}{" "}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setMessage(null);
                  setFieldErrors({});
                }}
                className="font-semibold text-text-primary-default hover:underline"
              >
                {isSignUp ? "כניסה לחשבון" : "הרשמה"}
              </button>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Left side */}
      <div className="hidden flex-1 bg-bg-surface lg:block" />
    </div>
  );
}
