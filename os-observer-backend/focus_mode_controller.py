from __future__ import annotations

import json
import os
import subprocess
import winreg
from pathlib import Path
# we  re simulating the process of focus, now that iseen the foucs is to inconsistem, and it changes 

TOAST_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\PushNotifications"
TOAST_VALUE_NAME = "ToastEnabled"
NOTIFICATIONS_SETTINGS_PATH = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings"
NOTIFICATION_VALUE_NAMES = ("Enabled", "ShowInActionCenter", "ShowBanners")
_STATE_FILE = Path(__file__).resolve().parent / ".runtime" / "focus_mode_state.json"

_AUDIO_SCRIPT = r"""
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AudioUtil {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  private class MMDeviceEnumeratorComObject {}
  private enum EDataFlow { eRender, eCapture, eAll }
  private enum ERole { eConsole, eMultimedia, eCommunications }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  private interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  private interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume ppInterface);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
  private interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }
  private static IAudioEndpointVolume GetEndpointVolume() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume volume;
    device.Activate(ref iid, 23, IntPtr.Zero, out volume);
    return volume;
  }
  public static bool GetMute() {
    bool muted;
    GetEndpointVolume().GetMute(out muted);
    return muted;
  }
  public static void SetMute(bool muted) {
    GetEndpointVolume().SetMute(muted, Guid.Empty);
  }
}
"@
"""


class FocusModeController:
    def __init__(self, event_callback=None) -> None:
        self.event_callback = event_callback
        self._supported = os.name == "nt"
        self._is_active = False
        self._saved_toast_enabled: int | None = None
        self._saved_audio_muted: bool | None = None
        self._saved_notification_values: dict[str, dict[str, int | None]] = {}
        self._recover_stale_state()

    def sync(self, state_label: str) -> None:
        should_be_active = self._supported and state_label in {"focused", "deep_focus"}
        if should_be_active == self._is_active:
            return
        if should_be_active:
            self._activate()
        else:
            self.restore()

    def restore(self) -> None:
        if not self._supported:
            return
        self._load_persisted_state()
        if not self._is_active and self._saved_toast_enabled is None:
            return
        self._restore_notifications()
        self._is_active = False
        self._clear_persisted_state()
        self._emit("Focused mode released: notifications restored.")

    def _activate(self) -> None:
        if not self._supported:
            return
        self._capture_current_state()
        self._persist_state()
        self._disable_notifications()
        self._is_active = True
        self._emit("Focused mode enabled: notifications off.")

    def _capture_current_state(self) -> None:
        if self._saved_toast_enabled is None:
            self._saved_toast_enabled = self._get_toast_enabled()
        if self._saved_audio_muted is None:
            self._saved_audio_muted = self._get_audio_muted()
        if not self._saved_notification_values:
            self._saved_notification_values = self._snapshot_notification_settings()

    def _disable_notifications(self) -> None:
        try:
            self._set_toast_enabled(0)
            self._set_notification_settings_enabled(False)
        except OSError:
            self._emit("Focused mode warning: could not disable Windows notifications.", persist=False)

    def _restore_notifications(self) -> None:
        if self._saved_toast_enabled is None:
            return
        try:
            self._set_toast_enabled(self._saved_toast_enabled)
            self._set_notification_settings_enabled(True)
        except OSError:
            self._emit("Focused mode warning: could not restore Windows notifications.", persist=False)
        finally:
            self._saved_toast_enabled = None

    def _restore_audio(self) -> None:
        if self._saved_audio_muted is None:
            return
        self._set_audio_muted(self._saved_audio_muted)
        self._saved_audio_muted = None

    def _get_toast_enabled(self) -> int:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, TOAST_REG_PATH) as key:
            try:
                value, _ = winreg.QueryValueEx(key, TOAST_VALUE_NAME)
            except FileNotFoundError:
                value = 1
        return int(value)

    def _set_toast_enabled(self, enabled: int) -> None:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, TOAST_REG_PATH) as key:
            winreg.SetValueEx(key, TOAST_VALUE_NAME, 0, winreg.REG_DWORD, int(enabled))

    def _snapshot_notification_settings(self) -> dict[str, dict[str, int | None]]:
        saved: dict[str, dict[str, int | None]] = {}
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, NOTIFICATIONS_SETTINGS_PATH) as root:
            index = 0
            while True:
                try:
                    subkey_name = winreg.EnumKey(root, index)
                    index += 1
                except OSError:
                    break
                subkey_path = f"{NOTIFICATIONS_SETTINGS_PATH}\\{subkey_name}"
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, subkey_path) as subkey:
                    saved[subkey_name] = {
                        value_name: self._query_dword(subkey, value_name)
                        for value_name in NOTIFICATION_VALUE_NAMES
                    }
        return saved

    def _set_notification_settings_enabled(self, enabled: bool) -> None:
        desired = 1 if enabled else 0
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, NOTIFICATIONS_SETTINGS_PATH) as root:
            index = 0
            subkeys: list[str] = []
            while True:
                try:
                    subkeys.append(winreg.EnumKey(root, index))
                    index += 1
                except OSError:
                    break

        for subkey_name in subkeys:
            subkey_path = f"{NOTIFICATIONS_SETTINGS_PATH}\\{subkey_name}"
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, subkey_path) as subkey:
                saved_values = self._saved_notification_values.get(subkey_name, {})
                for value_name in NOTIFICATION_VALUE_NAMES:
                    original = saved_values.get(value_name)
                    if enabled:
                        if original is None:
                            self._delete_value_if_present(subkey, value_name)
                        else:
                            winreg.SetValueEx(subkey, value_name, 0, winreg.REG_DWORD, int(original))
                    else:
                        winreg.SetValueEx(subkey, value_name, 0, winreg.REG_DWORD, desired)

        if enabled:
            self._saved_notification_values = {}

    @staticmethod
    def _query_dword(key, value_name: str) -> int | None:
        try:
            value, _ = winreg.QueryValueEx(key, value_name)
        except FileNotFoundError:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _delete_value_if_present(key, value_name: str) -> None:
        try:
            winreg.DeleteValue(key, value_name)
        except FileNotFoundError:
            return

    def _get_audio_muted(self) -> bool | None:
        output = self._run_audio_script("[AudioUtil]::GetMute()")
        if output is None:
            return None
        return output.strip().lower() == "true"

    def _set_audio_muted(self, muted: bool) -> None:
        self._run_audio_script(f"[AudioUtil]::SetMute(${str(muted).lower()})", expect_output=False)

    def _run_audio_script(self, action: str, *, expect_output: bool = True) -> str | None:
        command = [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            _AUDIO_SCRIPT + "\n" + action,
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            self._emit("Focused mode warning: could not control speaker mute.", persist=False)
            return None
        if result.returncode != 0:
            self._emit("Focused mode warning: audio control command failed.", persist=False)
            return None
        return result.stdout.strip() if expect_output else ""

    def _recover_stale_state(self) -> None:
        if not self._supported or not _STATE_FILE.exists():
            return
        self._load_persisted_state()
        if self._saved_toast_enabled is None and self._saved_audio_muted is None:
            self._clear_persisted_state()
            return
        self._restore_notifications()
        self._restore_audio()
        self._clear_persisted_state()
        self._emit("Recovered Windows notifications and speaker state from a previous focused session.", persist=False)

    def _persist_state(self) -> None:
        if self._saved_toast_enabled is None:
            return
        _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "toast_enabled": self._saved_toast_enabled,
            "audio_muted": self._saved_audio_muted,
            "notification_values": self._saved_notification_values,
        }
        _STATE_FILE.write_text(json.dumps(payload), encoding="utf-8")

    def _load_persisted_state(self) -> None:
        if self._saved_toast_enabled is not None or not _STATE_FILE.exists():
            return
        try:
            payload = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        toast_enabled = payload.get("toast_enabled")
        audio_muted = payload.get("audio_muted")
        notification_values = payload.get("notification_values", {})
        self._saved_toast_enabled = int(toast_enabled) if toast_enabled is not None else None
        self._saved_audio_muted = bool(audio_muted) if audio_muted is not None else None
        if isinstance(notification_values, dict):
            self._saved_notification_values = {
                str(subkey): {
                    value_name: (None if value is None else int(value))
                    for value_name, value in values.items()
                }
                for subkey, values in notification_values.items()
                if isinstance(values, dict)
            }

    def _clear_persisted_state(self) -> None:
        try:
            _STATE_FILE.unlink()
        except FileNotFoundError:
            return
        except OSError:
            return

    def _emit(self, message: str, persist: bool = True) -> None:
        if self.event_callback:
            self.event_callback(message, persist=persist)
