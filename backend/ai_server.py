import os
import sys
import uuid
import shutil
import subprocess
import traceback
import glob
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
import uvicorn

# [IMPORTANT] Import original api_v2 to reuse TTS logic
# The container mounts GPT-SoVITS at /workspace
sys.path.append("/workspace")
from api_v2 import APP as original_app, tts_handle, tts_pipeline

# Create a new FastAPI app to avoid route conflicts with api_v2.APP
# We only want OUR /tts handler, not the original one.
app = FastAPI()

# --- Fine-tuning wrapper logic ---

# # Base Model Paths (To be created by user via WebUI)
# # These should be in /workspace/GPT_SoVITS/pretrained_models/custom_base/
# BASE_S1_PATH = "/workspace/GPT_SoVITS/pretrained_models/custom_base/s1.ckpt"
# BASE_S2_PATH = "/workspace/GPT_SoVITS/pretrained_models/custom_base/s2.pth"
# Base Model Paths (Found in gsv-v2final-pretrained)
BASE_S1_PATH = "/workspace/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"
BASE_S2_PATH = "/workspace/GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth"

class TrainRequest(BaseModel):
    user_id: str
    model_name: str
    ref_audio_path: str
    ref_text: str

class TTSRequestWithModel(BaseModel):
    text: str
    text_lang: str
    model_path: str
    # Add other fields as needed or use kwargs
    prompt_lang: str = "ko"
    text_split_method: str = "cut5"
    speed_factor: float = 1.0

@app.post("/train_model")
async def train_model_wrapper(req: TrainRequest):
    """
    Wraps the CLI commands to train GPT-SoVITS.
    """
    try:
        # 1. Setup paths
        # Use user_id and model_name for unique directory
        safe_model_name = "".join([c for c in req.model_name if c.isalnum() or c in (' ', '_', '-')]).rstrip()
        dataset_root = f"/workspace/logs/{req.user_id}_{safe_model_name}"
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
        # In a real scenario, correct commands would be here.
        # For connection testing, we SIMULATE training by copying base models to the output dir.
        
        dummy_s1 = os.path.join(dataset_root, f"mock_s1_{safe_model_name}.ckpt")
        dummy_s2 = os.path.join(dataset_root, f"mock_s2_{safe_model_name}.pth")
        
        if os.path.exists(BASE_S1_PATH):
            shutil.copy(BASE_S1_PATH, dummy_s1)
        if os.path.exists(BASE_S2_PATH):
            shutil.copy(BASE_S2_PATH, dummy_s2)

        return {"model_path": dataset_root}
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")
async def tts_wrapper(req: TTSRequestWithModel):
    """
    Custom TTS endpoint that loads weights from model_path before inference.
    """
    try:
        model_root = req.model_path
        print(f"Requesting TTS with model: {model_root}")

        if not os.path.exists(model_root):
            raise HTTPException(status_code=404, detail="Model path not found")

        # 1. Load Weights from model_path
        # Look for .ckpt and .pth files
        gpt_models = glob.glob(os.path.join(model_root, "*.ckpt"))
        sovits_models = glob.glob(os.path.join(model_root, "*.pth"))

        if gpt_models:
            # Pick the newest one
            gpt_model = max(gpt_models, key=os.path.getmtime)
            print(f"Loading GPT weights: {gpt_model}")
            tts_pipeline.init_t2s_weights(gpt_model)
        
        if sovits_models:
            sovits_model = max(sovits_models, key=os.path.getmtime)
            print(f"Loading SoVITS weights: {sovits_model}")
            tts_pipeline.init_vits_weights(sovits_model)

        # 2. Resolve Reference Audio & Text
        ref_audio_path = os.path.join(model_root, "1_input.wav")
        prompt_text = ""

        # Read prompt text from 2-name2text.txt if exists
        name2text_path = os.path.join(model_root, "2-name2text.txt")
        if not os.path.exists(name2text_path):
            print(f"[ERROR] 2-name2text.txt not found at {name2text_path}")
        else:
            with open(name2text_path, "r", encoding="utf-8") as f:
                # format: filename|text|speaker|lang
                line = f.readline().strip()
                print(f"[DEBUG] Read line from 2-name2text.txt: {line}")
                parts = line.split("|")
                if len(parts) >= 2:
                    prompt_text = parts[1]
        
        print(f"[DEBUG] Using ref_audio: {ref_audio_path}, prompt_text: {prompt_text}")

        # 3. Construct Request for api_v2
        api_req = {
            "text": req.text,
            "text_lang": req.text_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": req.prompt_lang,
            "text_split_method": req.text_split_method,
            "speed_factor": req.speed_factor,
            # Add defaults for others
            "streaming_mode": False,
            "media_type": "wav"
        }
        
        print(f"[DEBUG] Calling tts_handle with req: {api_req}")
        return await tts_handle(api_req)

    except Exception as e:
        print("!!! EXCEPTION IN TTS WRAPPER !!!")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9880)
