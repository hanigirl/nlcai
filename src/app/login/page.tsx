"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import Image from "next/image";
import logoFull from "../../../images/logo-full.png";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSignUp, setIsSignUp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: `${firstName} ${lastName}`.trim(),
          },
        },
      });
      if (error) {
        setMessage(error.message);
      } else {
        setMessage("Check your email for a confirmation link.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setMessage(error.message);
      } else {
        window.location.href = "/";
      }
    }

    setLoading(false);
  }

  async function handleGoogleLogin() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <div dir="rtl" className="flex min-h-screen">
      {/* Right side - form */}
      <div className="flex w-full flex-col items-center justify-center px-6 lg:w-1/2">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center">
          <Image
            src={logoFull}
            alt="Postudio"
            className="h-[86px] w-auto"
            priority
          />
        </div>

        {/* Card */}
        <Card className="w-full max-w-md border-border-neutral-default rounded-3xl">
          <CardHeader className="items-center pb-2">
            <CardTitle className="text-2xl text-text-primary-default text-center">
              {isSignUp ? "היי, וולקאם!" : "טוב לראות אותך שוב..."}
            </CardTitle>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isSignUp && (
                <div className="flex gap-3">
                  <Input
                    type="text"
                    placeholder="שם פרטי *"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                  <Input
                    type="text"
                    placeholder="שם משפחה *"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              )}

              <Input
                type="email"
                placeholder="מייל *"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <Input
                type="password"
                placeholder="סיסמא *"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />

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
              המשיכו עם Google
            </Button>

            {/* Message */}
            {message && (
              <p className="mt-4 text-center text-small text-text-neutral-default">
                {message}
              </p>
            )}

            {/* Toggle sign up / sign in */}
            <p className="mt-6 text-center text-small text-text-neutral-default">
              {isSignUp ? "כבר יש לך חשבון?" : "אין לך חשבון?"}{" "}
              <button
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setMessage("");
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
