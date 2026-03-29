import pyttsx3
import threading
import queue

class VoiceCoach:
    def __init__(self):
        self.q = queue.Queue()
        self.thread = threading.Thread(target=self._worker, daemon=True, name="VoiceCoachWorker")
        self.thread.start()

    def _worker(self):
        try:
            engine = pyttsx3.init()
            # Slow down speech intentionally for a calm AI voice
            engine.setProperty("rate", 160)
            
            # Find a modern sounding voice if possible (usually Zira on Windows)
            voices = engine.getProperty('voices')
            for v in voices:
                if 'Zira' in v.name or 'Female' in v.name:
                    engine.setProperty('voice', v.id)
                    break
        except Exception:
            return # Silent fail if TTS is entirely missing
            
        while True:
            text = self.q.get()
            if text is None:
                break
            try:
                engine.say(text)
                engine.runAndWait()
            except Exception as e:
                print(f"Voice Coach TTS skipped: {e}")
            finally:
                self.q.task_done()

    def speak(self, text: str):
        self.q.put(text)
