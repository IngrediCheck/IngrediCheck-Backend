#!/usr/bin/env python3

import argparse
import gzip
import io
import json
import sys
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stream OFF JSONL.gz and estimate projected payload sizes.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--stdin", action="store_true", help="Read gzipped JSONL from stdin")
    source.add_argument("--input", type=str, help="Path to gzipped JSONL file")
    parser.add_argument("--sample", type=int, default=0, help="Number of records to process for sampling (0 = full stream)")
    parser.add_argument("--output", type=str, default="", help="Optional path to write JSON report")
    return parser.parse_args()


def iter_gz_lines_from_stdin() -> Iterable[str]:
    gz = gzip.GzipFile(fileobj=sys.stdin.buffer, mode="rb")
    with io.TextIOWrapper(gz, encoding="utf-8", errors="ignore", newline="\n") as f:
        for line in f:
            yield line


def iter_gz_lines_from_file(path: str) -> Iterable[str]:
    with gzip.open(path, mode="rt", encoding="utf-8", errors="ignore", newline="\n") as f:
        for line in f:
            yield line


def extract_display_image_urls(selected_images: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    if not isinstance(selected_images, dict):
        return []
    urls: List[Dict[str, str]] = []
    try:
        for image in selected_images.values():
            display = image.get("display") if isinstance(image, dict) else None
            if isinstance(display, dict):
                # Prefer English if available, else any string value
                if isinstance(display.get("en"), str):
                    urls.append({"url": display["en"]})
                else:
                    for v in display.values():
                        if isinstance(v, str):
                            urls.append({"url": v})
                            break
    except Exception:
        # Be tolerant to odd structures
        return urls
    return urls


def map_ingredient_node(node: Dict[str, Any]) -> Dict[str, Any]:
    mapped: Dict[str, Any] = {
        "name": node.get("text"),
        "vegan": node.get("vegan"),
        "vegetarian": node.get("vegetarian"),
        "ingredients": [],
    }
    sub = node.get("ingredients")
    if isinstance(sub, list) and len(sub) > 0:
        mapped["ingredients"] = [map_ingredient_node(child) for child in sub if isinstance(child, dict)]
    return mapped


def extract_projection(product: Dict[str, Any]) -> Dict[str, Any]:
    # Barcode / code
    barcode: Optional[str] = None
    code = product.get("code")
    if isinstance(code, str) and code.strip():
        barcode = code.strip()
    elif isinstance(code, (int, float)):
        barcode = str(code)
    elif isinstance(product.get("_id"), str):
        barcode = product.get("_id")

    # Brand
    brand: Optional[str] = None
    brand_owner = product.get("brand_owner")
    if isinstance(brand_owner, str) and brand_owner.strip():
        brand = brand_owner.strip()
    else:
        brands = product.get("brands")
        if isinstance(brands, str) and brands.strip():
            # OFF brands is comma-separated; take the first token
            brand = brands.split(",")[0].strip()

    # Name
    name: Optional[str] = None
    product_name = product.get("product_name")
    if isinstance(product_name, str) and product_name.strip():
        name = product_name.strip()
    else:
        # Try language-specific variants if present
        for k, v in product.items():
            if k.startswith("product_name_") and isinstance(v, str) and v.strip():
                name = v.strip()
                break

    # Ingredients
    ingredients_list: List[Dict[str, Any]] = []
    raw_ingredients = product.get("ingredients")
    if isinstance(raw_ingredients, list) and len(raw_ingredients) > 0:
        ingredients_list = [map_ingredient_node(node) for node in raw_ingredients if isinstance(node, dict)]

    # Images
    images: List[Dict[str, str]] = []
    selected_images = product.get("selected_images")
    images = extract_display_image_urls(selected_images)

    return {
        "barcode": barcode,
        "brand": brand,
        "name": name,
        "ingredients": ingredients_list,
        "images": images,
    }


def json_bytes(value: Any) -> int:
    try:
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except Exception:
        return 0


def utf8_bytes(value: Optional[str]) -> int:
    if value is None:
        return 0
    try:
        return len(value.encode("utf-8"))
    except Exception:
        return 0


def run(lines: Iterable[str], sample: int = 0) -> Dict[str, Any]:
    start = time.time()

    total_records = 0
    projected_records = 0
    barcode_bytes_total = 0
    brand_bytes_total = 0
    name_bytes_total = 0
    ingredients_bytes_total = 0
    images_bytes_total = 0

    nonempty_brand = 0
    nonempty_name = 0
    nonempty_ingredients = 0
    nonempty_images = 0

    processed = 0
    for raw in lines:
        if sample and processed >= sample:
            break
        total_records += 1
        raw = raw.strip()
        if not raw:
            continue
        try:
            product = json.loads(raw)
        except Exception:
            continue

        proj = extract_projection(product)
        if proj.get("barcode"):
            projected_records += 1
            barcode_bytes_total += utf8_bytes(proj.get("barcode"))

            b = proj.get("brand")
            if b:
                nonempty_brand += 1
                brand_bytes_total += utf8_bytes(b)

            n = proj.get("name")
            if n:
                nonempty_name += 1
                name_bytes_total += utf8_bytes(n)

            ing = proj.get("ingredients")
            if isinstance(ing, list) and len(ing) > 0:
                nonempty_ingredients += 1
                ingredients_bytes_total += json_bytes(ing)

            imgs = proj.get("images")
            if isinstance(imgs, list) and len(imgs) > 0:
                nonempty_images += 1
                images_bytes_total += json_bytes(imgs)

        processed += 1

    elapsed = time.time() - start

    result = {
        "total_records": total_records,
        "projected_records_with_barcode": projected_records,
        "barcode_bytes_total": barcode_bytes_total,
        "brand_bytes_total": brand_bytes_total,
        "name_bytes_total": name_bytes_total,
        "ingredients_bytes_total": ingredients_bytes_total,
        "images_bytes_total": images_bytes_total,
        "nonempty_counts": {
            "brand": nonempty_brand,
            "name": nonempty_name,
            "ingredients": nonempty_ingredients,
            "images": nonempty_images,
        },
        "elapsed_seconds": elapsed,
    }

    totals_payload = (
        barcode_bytes_total
        + brand_bytes_total
        + name_bytes_total
        + ingredients_bytes_total
        + images_bytes_total
    )
    result["projected_payload_bytes_total"] = totals_payload
    result["avg_payload_bytes_per_projected_row"] = (
        (totals_payload / projected_records) if projected_records else 0.0
    )

    return result


def main() -> None:
    args = parse_args()
    if args.stdin:
        lines = iter_gz_lines_from_stdin()
    else:
        lines = iter_gz_lines_from_file(args.input)

    result = run(lines, sample=args.sample)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

