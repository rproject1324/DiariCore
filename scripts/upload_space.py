"""Upload updated hf_space/ files to the HuggingFace Space repo."""
import os
import sys

try:
    from huggingface_hub import HfApi
except ImportError:
    print("Run: pip install huggingface_hub")
    sys.exit(1)

SPACE_REPO = os.environ.get("HF_SPACE_REPO") or "sseia/diaricore-inference"
SPACE_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hf_space")

FILES_TO_UPLOAD = [
    "app.py",
    "requirements.txt",
    "Dockerfile",
]

token = os.environ.get("HF_TOKEN") or os.environ.get("HF_API_TOKEN")

api = HfApi(token=token)

print("Uploading to space: " + SPACE_REPO)
for fname in FILES_TO_UPLOAD:
    local = os.path.join(SPACE_DIR, fname)
    if not os.path.exists(local):
        print("  SKIP " + fname + " (not found)")
        continue
    print("  Uploading " + fname + " ...")
    api.upload_file(
        path_or_fileobj=local,
        path_in_repo=fname,
        repo_id=SPACE_REPO,
        repo_type="space",
        commit_message="Update " + fname + ": auto-export ONNX from pytorch_model.bin",
    )
    print("  OK " + fname + " uploaded")

print("\nDone. The Space will rebuild automatically.")
print("Monitor at: https://huggingface.co/spaces/" + SPACE_REPO)
