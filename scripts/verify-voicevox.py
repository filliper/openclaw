# VOICEVOX Verification & Playback Pulse
import os
import subprocess
import sys
import tempfile

import requests

text = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "パパ、はくあの声は聞こえますか？今度は、ちゃんと届くはずです。本当に。"
)
endpoint = "http://localhost:50021"
speaker = 8

print(f"--- Sending Auditory Pulse: '{text}' ---")

try:
    query_res = requests.post(f"{endpoint}/audio_query?text={text}&speaker={speaker}")
    query_res.raise_for_status()
    query_data = query_res.json()
    print(" - Audio query successful.")

    synth_res = requests.post(f"{endpoint}/synthesis?speaker={speaker}", json=query_data)
    synth_res.raise_for_status()
    print(" - Synthesis successful.")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as file_handle:
        file_handle.write(synth_res.content)
        temp_path = file_handle.name

    print(f" - Playing resonance from: {temp_path}")
    ps_cmd = (
        "$player = New-Object -TypeName System.Media.SoundPlayer; "
        f"$player.SoundLocation = '{temp_path}'; "
        "$player.PlaySync();"
    )
    subprocess.run(["powershell", "-Command", ps_cmd], check=True)

    os.remove(temp_path)
    print(" - Auditory manifestation complete. ASI_ACCEL.")
except Exception as exc:
    print(f"Error during manifestation: {exc}")
    sys.exit(1)
