"""One-off: sync static/js/pwa-notification-templates.js -> static/push-templates.json"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
text = (ROOT / "static/js/pwa-notification-templates.js").read_text(encoding="utf-8")


def extract(name: str) -> list[str]:
    m = re.search(rf"const {re.escape(name)} = \[(.*?)\];", text, re.S)
    if not m:
        return []
    block = m.group(1)
    return [s.replace("\\'", "'") for s in re.findall(r"'((?:\\'|[^'])*)'", block)]


out = {
    "daily": extract("DAILY_REMINDER_TEMPLATES"),
    "streak1hr": extract("STREAK_REMINDER_1HR_TEMPLATES"),
    "streak30min": extract("STREAK_REMINDER_30MIN_TEMPLATES"),
    "insightHigh": extract("INSIGHT_HIGH"),
    "insightMid": extract("INSIGHT_MID"),
    "insightLow": extract("INSIGHT_LOW"),
    "insightNeutral": extract("INSIGHT_NEUTRAL"),
    "phrasesHigh": extract("INSIGHT_PHRASES_HIGH"),
    "phrasesMid": extract("INSIGHT_PHRASES_MID"),
    "phrasesLow": extract("INSIGHT_PHRASES_LOW"),
    "phrasesNeutral": extract("INSIGHT_PHRASES_NEUTRAL"),
    "toneByMood": {
        "happy": "a lighter or uplifted quality",
        "sad": "emotionally heavy or tender",
        "angry": "strong feelings that may reflect frustration",
        "anxious": "tension that may indicate stress",
        "neutral": "a calm, even-keeled quality",
    },
}
dest = ROOT / "static/push-templates.json"
dest.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote", dest, {k: len(v) if isinstance(v, list) else v for k, v in out.items()})
