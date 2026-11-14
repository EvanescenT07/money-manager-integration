"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createApiClient } from "@/lib/rpc";
import type { ApiErrorResponse } from "@/types/api";
import { AlertCircleIcon, LockKeyIcon } from "./icons";

export function PinLoginView() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPasscode = passcode.trim();

    if (!trimmedPasscode) {
      setErrorMessage("Masukkan passcode dashboard terlebih dahulu.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const client = createApiClient();
      const response = await client.api.auth.login.$post({
        json: { passcode: trimmedPasscode },
      });

      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiErrorResponse | null;
        setErrorMessage(
          payload?.error ??
            `Autentikasi gagal (HTTP ${response.status}). Periksa passcode Anda.`
        );
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Tidak dapat menghubungi server autentikasi.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      id="main-content"
      className="flex min-h-dvh flex-col items-center justify-center bg-[#090B0E] px-4 py-8 sm:px-6"
    >
      <div className="w-full max-w-md scroll-mb-24 rounded-lg border border-[#242B35] bg-[#11151B] p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3 border-b border-[#242B35] pb-4">
          <span className="font-mono text-sm font-semibold tracking-wide text-[#34D399]">
            MM-AutoSync
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-[#64748B] bg-[#171C24] px-2.5 py-1 font-mono text-xs text-[#CBD5E1]">
            <LockKeyIcon size={14} className="text-[#34D399]" />
            <span>CONSOLE AUTH</span>
          </span>
        </div>

        <div className="mt-6">
          <h1 className="text-xl font-semibold tracking-tight text-[#F1F5F9] sm:text-2xl">
            Masuk ke Telemetry Console
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#A8B3C2]">
            Masukkan passcode dashboard untuk memantau log transaksi AI dan status
            sinkronisasi MacroDroid.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="dashboard-passcode"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              Passcode Dashboard
            </label>
            <div className="mt-2 flex items-stretch gap-2">
              <input
                id="dashboard-passcode"
                name="passcode"
                type={showPasscode ? "text" : "password"}
                autoComplete="current-password"
                value={passcode}
                onChange={(event) => {
                  setPasscode(event.target.value);
                  if (errorMessage) {
                    setErrorMessage(null);
                  }
                }}
                placeholder="Masukkan passcode"
                aria-invalid={errorMessage ? "true" : "false"}
                aria-describedby={
                  errorMessage ? "passcode-error" : "passcode-help"
                }
                disabled={isSubmitting}
                className="min-h-[44px] w-full min-w-0 rounded-md border border-[#64748B] bg-[#171C24] px-3.5 py-2.5 font-mono text-sm text-[#F1F5F9] placeholder:font-sans placeholder:text-[#94A3B8] focus:border-[#34D399]"
              />
              <button
                type="button"
                onClick={() => setShowPasscode((prev) => !prev)}
                aria-label={
                  showPasscode ? "Sembunyikan passcode" : "Tampilkan passcode"
                }
                aria-pressed={showPasscode}
                className="min-h-[44px] min-w-[64px] shrink-0 rounded-md border border-[#64748B] bg-[#171C24] px-3 text-xs font-medium text-[#CBD5E1] transition-colors hover:border-[#94A3B8] hover:bg-[#1E2530] hover:text-[#F1F5F9]"
              >
                {showPasscode ? "Tutup" : "Lihat"}
              </button>
            </div>
            <p id="passcode-help" className="mt-2 text-xs text-[#94A3B8]">
              Passcode diverifikasi secara timing-safe terhadap konfigurasi server.
            </p>
          </div>

          {errorMessage ? (
            <div
              id="passcode-error"
              role="alert"
              className="flex items-start gap-2.5 rounded-md border border-[#F43F5E] bg-[#260E15] px-3.5 py-3 text-sm text-[#FB7185]"
            >
              <AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-[44px] w-full rounded-md bg-[#10B981] px-4 py-2.5 text-sm font-semibold text-[#04120C] transition-colors hover:bg-[#34D399] disabled:cursor-not-allowed disabled:border disabled:border-[#64748B] disabled:bg-[#1E2530] disabled:text-[#94A3B8]"
          >
            {isSubmitting ? "Memverifikasi passcode..." : "Buka Dashboard"}
          </button>
        </form>

        <p className="mt-6 border-t border-[#242B35] pt-4 text-xs leading-relaxed text-[#94A3B8]">
          Sesi disimpan sebagai cookie HttpOnly bertanda tangan HMAC dengan masa
          berlaku 7 hari.
        </p>
      </div>
    </main>
  );
}
