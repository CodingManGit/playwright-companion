#!/usr/bin/env python3
"""
Crop Box Helper for Browser Interactive Annotator

Takes a full-viewport browser screenshot and crops the exact rectangular region
defined by a user annotation box (accounting for device pixel ratio / HiDPI scaling).

Usage:
  uv run --with pillow python crop_box.py --image <screenshot.png> --box <x> <y> <w> <h> [options]
  uv run --with pillow python crop_box.py --image <screenshot.png> --json '{"box":{"x":100,"y":50,"width":200,"height":80},"viewport":{"dpr":2}}'
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print(json.dumps({
        "status": "error",
        "message": "Pillow is required. Run via: uv run --with pillow python crop_box.py ..."
    }))
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(description="Crop an annotated bounding box from a viewport screenshot.")
    parser.add_argument("--image", required=True, help="Path to viewport screenshot image (PNG/JPEG)")
    parser.add_argument("--box", nargs=4, type=float, metavar=("X", "Y", "W", "H"), help="Box coordinates in CSS pixels (page coordinates by default; see --scroll)")
    parser.add_argument("--json", dest="json_data", help="Annotation JSON string or path to JSON file containing box and viewport")
    parser.add_argument("--scroll", nargs=2, type=float, default=None, metavar=("SCROLL_X", "SCROLL_Y"),
                        help="Page scroll offset at screenshot time. Annotations are stored in page (document) coordinates; "
                             "pass the current scrollX/scrollY to convert them to viewport coordinates for cropping a viewport screenshot. "
                             "Use 0 0 for full-page screenshots.")
    parser.add_argument("--dpr", type=float, default=None, help="Device pixel ratio (e.g. 1.0, 2.0). Auto-inferred if omitted.")
    parser.add_argument("--viewport-width", type=float, default=None, help="CSS viewport width (used to infer scale if DPR omitted)")
    parser.add_argument("--padding", type=int, default=0, help="Extra padding in CSS pixels around the box (default: 0)")
    parser.add_argument("--output", default=None, help="Output file path. Defaults to /tmp/anno_crop_<id>.png")
    return parser.parse_args()


def main():
    args = parse_args()
    image_path = Path(args.image)
    if not image_path.exists():
        print(json.dumps({"status": "error", "message": f"Image file not found: {args.image}"}))
        sys.exit(1)

    box_x = box_y = box_w = box_h = None
    dpr = args.dpr
    padding = args.padding

    if args.json_data:
        try:
            if os.path.exists(args.json_data):
                with open(args.json_data, "r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = json.loads(args.json_data)
            
            # Handle array of annotations or single annotation object
            if isinstance(data, list) and len(data) > 0:
                data = data[-1]  # Use latest annotation
            
            box = data.get("box", {})
            box_x = float(box.get("x", 0))
            box_y = float(box.get("y", 0))
            box_w = float(box.get("width", 0))
            box_h = float(box.get("height", 0))

            if dpr is None and "viewport" in data:
                dpr = float(data["viewport"].get("dpr", 1.0))
                if not args.viewport_width and "width" in data["viewport"]:
                    args.viewport_width = float(data["viewport"]["width"])
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Failed to parse JSON data: {e}"}))
            sys.exit(1)
    elif args.box:
        box_x, box_y, box_w, box_h = args.box
    else:
        print(json.dumps({"status": "error", "message": "Either --box <x> <y> <w> <h> or --json must be provided."}))
        sys.exit(1)

    # Annotations are stored in page (document) coordinates. To crop a viewport
    # screenshot, convert to viewport coordinates by subtracting the scroll offset.
    scroll_used = None
    if args.scroll is not None:
        scroll_used = (args.scroll[0], args.scroll[1])
        box_x -= scroll_used[0]
        box_y -= scroll_used[1]

    with Image.open(image_path) as im:
        img_w, img_h = im.size

        # Infer scale factor
        if dpr is not None:
            scale_x = scale_y = dpr
        elif args.viewport_width and args.viewport_width > 0:
            scale_x = scale_y = img_w / args.viewport_width
        else:
            # Assume 1.0 or standard scale
            scale_x = scale_y = 1.0

        # Calculate crop coordinates in actual image pixels
        x1 = max(0, int((box_x - padding) * scale_x))
        y1 = max(0, int((box_y - padding) * scale_y))
        x2 = min(img_w, int((box_x + box_w + padding) * scale_x))
        y2 = min(img_h, int((box_y + box_h + padding) * scale_y))

        if x2 <= x1 or y2 <= y1:
            print(json.dumps({
                "status": "error",
                "message": f"Invalid crop coordinates: [{x1}, {y1}, {x2}, {y2}] for image size ({img_w}, {img_h})"
            }))
            sys.exit(1)

        cropped = im.crop((x1, y1, x2, y2))

        # Output path
        if args.output:
            out_path = Path(args.output)
        else:
            out_path = Path(f"/tmp/anno_crop_{int(box_x)}_{int(box_y)}.png")
        
        out_path.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(out_path, format="PNG")

        result = {
            "status": "success",
            "cropped_image": str(out_path.resolve()),
            "dimensions": {"width": cropped.width, "height": cropped.height},
            "original_image": str(image_path.resolve()),
            "scale_used": scale_x,
            "crop_rect_pixels": [x1, y1, x2, y2],
            "css_box": [box_x, box_y, box_w, box_h],
            "scroll_used": scroll_used
        }
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
