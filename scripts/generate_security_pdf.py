"""Generate plain-text PDF from SECURITY_REQUIREMENTS_VERIFICATION.md."""
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "SECURITY_REQUIREMENTS_VERIFICATION.md"
OUT = ROOT / "docs" / "SECURITY_REQUIREMENTS_VERIFICATION.pdf"


class ReportPDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 8, f"Page {self.page_no()}", align="C")


def is_section_title(line: str) -> bool:
    if not line or line.startswith(" ") or line.startswith("-"):
        return False
    if line.startswith("Letter ") and "—" in line:
        return True
    if line.endswith(":") and len(line) < 80 and line[0].isupper():
        return True
    upper = sum(1 for c in line if c.isupper())
    return len(line) > 12 and upper > len(line) * 0.6 and "." not in line[:3]


def write_line(pdf: ReportPDF, text: str, h: float = 5) -> None:
    safe = text.encode("ascii", "replace").decode("ascii").strip()
    if not safe:
        pdf.ln(2)
        return
    w = pdf.w - pdf.l_margin - pdf.r_margin
    pdf.multi_cell(w, h, safe)


def main():
    pdf = ReportPDF()
    pdf.set_margins(18, 18, 18)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("Helvetica", "", 10)

    text = SRC.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("===="):
            continue
        if not line:
            pdf.ln(3)
            continue
        if "Final Project Security Requirements" in line and line.startswith("DiariCore"):
            pdf.set_font("Helvetica", "B", 14)
            write_line(pdf, line, 7)
            pdf.ln(2)
            pdf.set_font("Helvetica", "", 10)
            continue
        if is_section_title(line):
            pdf.ln(4)
            pdf.set_font("Helvetica", "B", 11)
            write_line(pdf, line, 6)
            pdf.set_font("Helvetica", "", 10)
            continue
        write_line(pdf, line, 5)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
