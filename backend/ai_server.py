import os
import sys
import uuid
import shutil
import subprocess
import traceback
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
import uvicorn

# [IMPORTANT] Import original api_v2 to reuse TTS logic
# The container mounts GPT-SoVITS at /workspace
sys.path.append("/workspace")
from api_v2 import APP as original_app, tts_handle

# Create a new FastAPI app that wraps the original one or extends it
app = original_app

# --- Fine-tuning wrapper logic ---

# Base Model Paths (To be created by user via WebUI)
# These should be in /workspace/GPT_SoVITS/pretrained_models/custom_base/
BASE_S1_PATH = "/workspace/GPT_SoVITS/pretrained_models/custom_base/s1.ckpt"
BASE_S2_PATH = "/workspace/GPT_SoVITS/pretrained_models/custom_base/s2.pth"

class TrainRequest(BaseModel):
    user_id: str
    ref_audio_path: str
    ref_text: str

@app.post("/train_model")
async def train_model_wrapper(req: TrainRequest):
    """
    Wraps the CLI commands to train GPT-SoVITS.
    """
    try:
        # 1. Setup paths
        dataset_root = f"/workspace/logs/{req.user_id}"
        os.makedirs(dataset_root, exist_ok=True)
        
        # Audio file path (from shared volume)
        source_audio = req.ref_audio_path
        if not os.path.exists(source_audio):
             raise HTTPException(status_code=400, detail=f"Audio file not found at {source_audio}")

        # 2. Preprocessing & Formatting
        target_wav_name = "1_input.wav"
        target_wav_path = os.path.join(dataset_root, target_wav_name)
        shutil.copy(source_audio, target_wav_path)
        
        with open(os.path.join(dataset_root, "2-name2text.txt"), "w", encoding="utf-8") as f:
            f.write(f"{target_wav_name}|{req.ref_text}|{req.user_id}|ko\n")

        # 3. Training Execution (Mocked for now)
        # In a real scenario, we would generate config files here using BASE_S1_PATH and BASE_S2_PATH
        # as 'pretrained_s1' and 'pretrained_s2G/D'.
        
        # Example command construction:
        # cmd_s2 = f"python GPT_SoVITS/s2_train.py --config ... --pretrained_s2G {BASE_S2_PATH} ..."
        # subprocess.run(cmd_s2, shell=True)
        
        # Check if base models exist (Warning only for now)
        if not os.path.exists(BASE_S1_PATH) or not os.path.exists(BASE_S2_PATH):
            print(f"[WARNING] Base models not found at {BASE_S1_PATH} or {BASE_S2_PATH}. "
                  "Please ensure you have trained the base model using WebUI and placed it there.")

        # [CRITICAL] Returning the dataset root as the 'model_path'
        # The inference logic needs to find the *finetuned* weights here.
        # Since we are mocking, we can copy the base model here to simulate a result?
        # Or just return the path.
        
        return {"model_path": dataset_root}
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9880)
