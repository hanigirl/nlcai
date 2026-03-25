"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Avatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string;
  preview_video_url: string;
}

type Step = "select" | "record" | "generating" | "done";

export default function AvatarsPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Flow state
  const [step, setStep] = useState<Step>("select");
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Video state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    fetch("/api/avatars")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAvatars(data.avatars);
      })
      .catch(() => setError("Failed to load avatars"))
      .finally(() => setLoading(false));
  }, []);

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setAudioBlob(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);

      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch {
      setError("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const pollVideoStatus = useCallback((id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${id}`);
        const data = await res.json();

        if (data.status === "completed" && data.video_url) {
          clearInterval(interval);
          setVideoUrl(data.video_url);
          setStep("done");
        } else if (data.status === "failed" || data.error) {
          clearInterval(interval);
          setVideoError(
            data.error?.message || data.error || "Video generation failed"
          );
          setStep("done");
        } else {
          setProgress(
            data.status === "processing"
              ? "HeyGen is rendering your video..."
              : `Status: ${data.status}`
          );
        }
      } catch {
        clearInterval(interval);
        setVideoError("Lost connection while checking video status");
        setStep("done");
      }
    }, 5000);
  }, []);

  const handleGenerate = async () => {
    if (!selectedAvatar || !audioBlob) return;

    setStep("generating");
    setProgress("Uploading your recording...");
    setVideoError(null);
    setVideoUrl(null);

    try {
      // 1. Upload audio to HeyGen
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const uploadRes = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (uploadData.error) {
        setVideoError(uploadData.error);
        setStep("done");
        return;
      }

      // 2. Generate video with the uploaded audio URL
      setProgress("Sending to HeyGen...");
      const genRes = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar_id: selectedAvatar.avatar_id,
          audio_url: uploadData.url,
        }),
      });

      const genData = await genRes.json();

      if (genData.error) {
        setVideoError(genData.error);
        setStep("done");
        return;
      }

      setProgress("HeyGen is rendering your video...");
      pollVideoStatus(genData.video_id);
    } catch {
      setVideoError("Failed to start video generation");
      setStep("done");
    }
  };

  const handleStartOver = () => {
    setStep("select");
    setSelectedAvatar(null);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setVideoUrl(null);
    setVideoError(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground text-lg animate-pulse">
          Loading your avatars...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive text-lg">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Avatars</h1>
            <p className="text-muted-foreground mt-1">
              {step === "select" && "Pick an avatar to create a video"}
              {step === "record" &&
                `Record your voice for ${selectedAvatar?.avatar_name}`}
              {step === "generating" && "Generating your video..."}
              {step === "done" &&
                (videoUrl ? "Your video is ready!" : "Something went wrong")}
            </p>
          </div>
          {step !== "select" && (
            <Button variant="outline" onClick={handleStartOver}>
              Start Over
            </Button>
          )}
        </div>

        {/* Step 1: Avatar Selection */}
        {step === "select" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {avatars.map((avatar) => (
              <Card
                key={avatar.avatar_id}
                className="overflow-hidden transition-all hover:shadow-lg cursor-pointer hover:ring-2 hover:ring-primary"
                onClick={() => {
                  setSelectedAvatar(avatar);
                  setStep("record");
                }}
                onMouseEnter={() => setHoveredId(avatar.avatar_id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="relative aspect-video bg-muted">
                  {hoveredId === avatar.avatar_id &&
                  avatar.preview_video_url ? (
                    <video
                      src={avatar.preview_video_url}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Image
                      src={avatar.preview_image_url}
                      alt={avatar.avatar_name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  )}
                </div>
                <CardContent className="p-4">
                  <h2 className="font-semibold text-lg">
                    {avatar.avatar_name}
                  </h2>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Step 2: Record Voice */}
        {step === "record" && selectedAvatar && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Avatar preview */}
            <Card className="overflow-hidden">
              <div className="relative aspect-video bg-muted">
                <Image
                  src={selectedAvatar.preview_image_url}
                  alt={selectedAvatar.avatar_name}
                  fill
                  className="object-cover"
                  sizes="50vw"
                />
              </div>
              <CardContent className="p-4">
                <h2 className="font-semibold text-xl">
                  {selectedAvatar.avatar_name}
                </h2>
              </CardContent>
            </Card>

            {/* Recording controls */}
            <div className="flex flex-col items-center justify-center gap-6">
              {/* Mic button */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`relative size-32 rounded-full flex items-center justify-center transition-all ${
                  isRecording
                    ? "bg-destructive text-white scale-110"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
              >
                {isRecording && (
                  <span className="absolute inset-0 rounded-full bg-destructive/30 animate-ping" />
                )}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-12"
                >
                  {isRecording ? (
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  ) : (
                    <>
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </>
                  )}
                </svg>
              </button>

              {/* Timer / Instructions */}
              {isRecording ? (
                <div className="text-center">
                  <p className="text-2xl font-mono font-bold text-destructive">
                    {formatTime(recordingTime)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Recording... Click to stop
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-center">
                  {audioBlob
                    ? "Recording saved. Play it back or re-record."
                    : "Tap the microphone to start recording"}
                </p>
              )}

              {/* Playback */}
              {audioUrl && !isRecording && (
                <div className="w-full max-w-sm">
                  <audio
                    src={audioUrl}
                    controls
                    className="w-full"
                  />
                </div>
              )}

              {/* Actions */}
              {audioBlob && !isRecording && (
                <div className="flex gap-3">
                  <Button variant="outline" onClick={startRecording}>
                    Re-record
                  </Button>
                  <Button size="lg" onClick={handleGenerate}>
                    Generate Video
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Generating */}
        {step === "generating" && (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="relative size-16">
              <div className="absolute inset-0 rounded-full border-4 border-muted" />
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            </div>
            <p className="text-lg text-muted-foreground">{progress}</p>
            <p className="text-sm text-muted-foreground/60">
              This usually takes 1-3 minutes
            </p>
          </div>
        )}

        {/* Step 4: Result */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-6 py-10">
            {videoError && (
              <div className="text-destructive text-center">
                <p className="text-lg font-medium">Generation failed</p>
                <p className="text-sm mt-1">{videoError}</p>
              </div>
            )}

            {videoUrl && (
              <div className="w-full max-w-3xl">
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  className="w-full rounded-xl shadow-lg"
                />
                <div className="flex gap-3 mt-4 justify-center">
                  <Button asChild>
                    <a
                      href={videoUrl}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download Video
                    </a>
                  </Button>
                  <Button variant="outline" onClick={handleStartOver}>
                    Create Another
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
