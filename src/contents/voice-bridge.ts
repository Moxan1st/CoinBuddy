import type { PlasmoCSConfig } from "plasmo"

// This script runs in the MAIN world — has access to MediaRecorder + microphone
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  world: "MAIN"
}

let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []

function emit(detail: Record<string, any>) {
  window.dispatchEvent(
    new CustomEvent("coinbuddy:voice-result", { detail })
  )
}

function cleanup() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop() } catch (_) {}
  }
  mediaRecorder = null
  audioChunks = []
}

// Stop recording → assemble audio → send as base64
function handleStop() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    emit({ error: "not_recording" })
    return
  }
  // Calling stop() triggers the onstop handler which assembles and emits
  mediaRecorder.stop()
}

// Start recording
async function handleStart() {
  // Kill any previous session
  cleanup()

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []

    // Prefer webm/opus, fall back to whatever is available
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : ""

    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      // Stop all tracks to release mic
      stream.getTracks().forEach((t) => t.stop())

      if (audioChunks.length === 0) {
        emit({ error: "no_audio" })
        return
      }

      const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || "audio/webm" })
      audioChunks = []

      // Convert to base64
      const reader = new FileReader()
      reader.onloadend = () => {
        const dataUrl = reader.result as string
        // dataUrl = "data:audio/webm;codecs=opus;base64,XXXX..."
        const base64 = dataUrl.split(",")[1]
        const mime = dataUrl.split(";base64,")[0].split(":")[1]
        emit({ audioBase64: base64, mimeType: mime })
      }
      reader.onerror = () => emit({ error: "read_failed" })
      reader.readAsDataURL(blob)
    }

    mediaRecorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop())
      emit({ error: "recorder_error" })
    }

    mediaRecorder.start()
    console.log("[CoinBuddy Voice] Recording started")
  } catch (err: any) {
    console.error("[CoinBuddy Voice] Start failed:", err)
    emit({ error: err.name === "NotAllowedError" ? "mic_denied" : err.message })
  }
}

window.addEventListener("coinbuddy:voice-start", handleStart)
window.addEventListener("coinbuddy:voice-stop", handleStop)

console.log("[CoinBuddy Voice] MediaRecorder bridge loaded in MAIN world")
