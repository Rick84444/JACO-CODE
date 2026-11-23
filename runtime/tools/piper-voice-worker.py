# Aura's voice: one long-lived Piper TTS process that keeps the Alma model loaded.
# Starting `python -m piper` per sentence costs about nine seconds of model loading; this worker pays it once.
# Protocol: one JSON object per line on stdin {"id": str, "text": str, "out": absolute .wav path};
# one JSON object per line on stdout {"id": str, "ok": bool, "error"?: str}. Nothing else is printed.
import json
import sys
import wave

from piper import PiperVoice


def main() -> None:
    model = sys.argv[1]
    voice = PiperVoice.load(model)
    print(json.dumps({"id": "ready", "ok": True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = str(request.get("id"))
            text = str(request.get("text") or "")[:6000]
            out = str(request["out"])
            if not text.strip() or not out.lower().endswith(".wav"):
                raise ValueError("PIPER_REQUEST_INVALID")
            with wave.open(out, "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
            print(json.dumps({"id": request_id, "ok": True}), flush=True)
        except Exception as error:  # report and keep serving; one bad request must not mute Aura
            print(json.dumps({"id": request_id, "ok": False, "error": type(error).__name__}), flush=True)


if __name__ == "__main__":
    main()
