# Model weights (not in this repo)

Training checkpoints and ONNX exports are stored on **HuggingFace Hub** (`sseia/diari-core-mood`), not in git.

- **Production mood API:** `space_nlp.py` calls the HF Space (`SPACE_URL`, default `sseia-diaricore-inference`).
- **Space deployment code:** `hf_space/` (upload with `scripts/upload_space.py`).

To export or re-upload weights, clone them from the Hub locally or use the training notebook history in git.
