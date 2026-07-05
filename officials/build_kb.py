#!/usr/bin/env python3
"""
Разбивает официальные PDF (Player's Handbook и т.п.) в локальную базу знаний,
удобную для grep: одна страница = один текстовый файл, номер страницы в имени.

Запуск:  officials/.kbvenv/bin/python officials/build_kb.py
Зависимость: pymupdf (ставится в officials/.kbvenv).

Добавить новую книгу — допишите строку в BOOKS ниже.
"""
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent
KB = ROOT / "kb"

# (файл PDF, slug каталога, человекочитаемое название)
BOOKS = [
    ("PlayersHandbook2024 EN.pdf", "phb-2024-en", "Player's Handbook 2024 (EN)"),
    ("Player's Handbook 2024. RU.pdf", "phb-2024-ru", "Книга игрока 2024 (RU)"),
]

# Мусорные символы, мешающие grep: BOM, zero-width space/joiner, мягкий перенос.
_DROP = [0xFEFF, 0x200B, 0x200C, 0x200D, 0x00AD]
# Разные пробелы → обычный; неразрывные дефисы → обычный дефис.
_MAP = {
    0x00A0: " ", 0x202F: " ", 0x2009: " ", 0x2007: " ", 0x2060: " ",
    0x2011: "-", 0x2010: "-",
}
TRANS = {cp: None for cp in _DROP}
TRANS.update(_MAP)


def clean(text: str) -> str:
    # RU: перенос слова мягким дефисом на конце строки — склеиваем слово,
    # иначе grep по цельному слову («обладают») не найдёт «обла\nдают».
    text = re.sub(chr(0x00AD) + r"[ \t]*\n[ \t]*", "", text)
    # EN: перенос обычным дефисом между строчными буквами — тоже склеиваем
    # («charac-\nter» → «character»). Дефисы между заглавными/составные не трогаем.
    text = re.sub(r"([a-zа-яё])-\n[ \t]*([a-zа-яё])", r"\1\2", text)
    text = text.translate(TRANS)
    # Пробел(ы) перед переводом строки убираем, схлопываем 3+ пустых строки.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def build_book(pdf_name: str, slug: str, title: str) -> int:
    pdf_path = ROOT / pdf_name
    if not pdf_path.exists():
        print(f"  ПРОПУСК: нет файла {pdf_name}")
        return 0

    out_dir = KB / slug
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    width = max(3, len(str(doc.page_count)))

    for i, page in enumerate(doc, start=1):
        body = clean(page.get_text("text"))
        header = f"# {title} — PDF-страница {i}/{doc.page_count}\n\n"
        (pages_dir / f"page-{i:0{width}d}.txt").write_text(header + body, encoding="utf-8")

    # Оглавление из закладок PDF (если есть).
    toc = doc.get_toc()
    lines = [f"# Оглавление — {title}", f"Источник: {pdf_name}", f"Страниц: {doc.page_count}", ""]
    if toc:
        for level, name, pno in toc:
            lines.append(f"{'  ' * (level - 1)}- {name.strip()} … стр. {pno}")
    else:
        lines.append("(в PDF нет закладок)")
    (out_dir / "toc.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    doc.close()
    count = len(list(pages_dir.glob("page-*.txt")))
    print(f"  {title}: {count} страниц -> {pages_dir.relative_to(ROOT)}")
    return 1


def main() -> None:
    KB.mkdir(exist_ok=True)
    built = sum(build_book(*b) for b in BOOKS)
    print(f"Готово: обработано книг — {built}")
    if not built:
        sys.exit(1)


if __name__ == "__main__":
    main()
