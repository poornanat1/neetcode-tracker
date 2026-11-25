"""Convert the Schedule worksheet to the app's seed data."""
import argparse
import json
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile


def read_schedule(path, *, include_progress=False):
    with ZipFile(path) as workbook:
        strings = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        relationships = ET.fromstring(
            workbook.read("xl/worksheets/_rels/sheet1.xml.rels")
        )

    shared = ["".join(t.text or "" for t in item.findall(".//{*}t")) for item in strings]
    targets = {link.get("Id"): link.get("Target") for link in relationships}
    links = {
        item.get("ref"): targets[item.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        )]
        for item in sheet.findall(".//{*}hyperlink")
    }
    problems, sessions = [], []
    for row in sheet.findall(".//{*}sheetData/{*}row"):
        number = int(row.get("r"))
        if number < 5:
            continue
        values = {}
        for cell in row:
            value = cell.findtext("{*}v")
            if value is not None:
                column = cell.get("r").rstrip("0123456789")
                values[column] = shared[int(value)] if cell.get("t") == "s" else value
        if not values.get("A") or not values.get("C"):
            continue
        scheduled = date(1899, 12, 30) + timedelta(days=int(values["A"]))
        entry = {"date": scheduled.isoformat(), "title": values["C"]}
        if values.get("E"):
            url = links.get(f"C{number}", "")
            problems.append({
                **entry, "id": str(number), "topic": values["D"],
                "difficulty": values["E"],
                "url": url if url.startswith("https://") else "",
                "status": values.get("F", "") if include_progress else "",
                "note": values.get("G", "") if include_progress else "",
            })
        else:
            sessions.append(entry)
    return {"problems": problems, "sessions": sessions}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook")
    parser.add_argument("--include-progress", action="store_true")
    args = parser.parse_args()
    data = read_schedule(args.workbook, include_progress=args.include_progress)
    output = Path(__file__).resolve().parents[1] / "src" / "schedule.json"
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(data['problems'])} problems and {len(data['sessions'])} sessions.")
