"""Create transparent app icons without altering the supplied artwork file."""

import argparse
from collections import deque
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


# LOGIC — remove only the edge-connected white background, not book highlights.
def remove_white_corners(source):
    image = source.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    outside = bytearray(width * height)
    queue = deque([0, width - 1, width * (height - 1), width * height - 1])
    while queue:
        index = queue.popleft()
        if seen[index]:
            continue
        seen[index] = 1
        x, y = index % width, index // width
        red, green, blue, alpha = pixels[x, y]
        if alpha > 0 and (min(red, green, blue) < 235 or max(red, green, blue) - min(red, green, blue) > 25):
            continue
        outside[index] = 255
        if x > 0:
            queue.append(index - 1)
        if x + 1 < width:
            queue.append(index + 1)
        if y > 0:
            queue.append(index - width)
        if y + 1 < height:
            queue.append(index + width)

    mask = Image.frombytes("L", image.size, bytes(outside))
    band = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(7)), mask).load()
    result = image.copy()
    output = result.load()
    for y in range(height):
        for x in range(width):
            if outside[y * width + x]:
                output[x, y] = (0, 0, 0, 0)
                continue
            color = pixels[x, y][:3]
            if not band[x, y] or min(color) < 45 or max(color) - min(color) > 65:
                continue
            # Recover dark outline color from white-composited antialias pixels.
            candidates = []
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height and not outside[ny * width + nx]:
                        neighbor = pixels[nx, ny][:3]
                        if max(neighbor) < 90:
                            candidates.append((dx * dx + dy * dy, neighbor))
            if not candidates:
                continue
            foreground = min(candidates, key=lambda item: item[0])[1]
            direction = [255 - channel for channel in foreground]
            alpha = min(1.0, max(0.0, sum((255 - color[i]) * direction[i] for i in range(3)) / sum(value * value for value in direction)))
            if 0 < alpha < 0.98:
                recovered = tuple(max(0, min(255, round(255 + (channel - 255) / alpha))) for channel in color)
                output[x, y] = (*recovered, round(pixels[x, y][3] * alpha))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    destination = Path(__file__).resolve().parent / "assets"
    destination.mkdir(exist_ok=True)
    with Image.open(args.source) as source:
        original = source.convert("RGBA")
        icon = remove_white_corners(original)
    width, height = icon.size
    assert all(icon.getpixel(point)[3] == 0 for point in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)])
    assert icon.getpixel((width // 2, height // 2)) == original.getpixel((width // 2, height // 2))
    png = destination / "app-icon.png"
    ico = destination / "app-icon.ico"
    icon.save(png, optimize=True)
    sizes = [(size, size) for size in [16, 20, 24, 32, 40, 48, 64, 128, 256]]
    icon.save(ico, format="ICO", bitmap_format="bmp", sizes=sizes)
    print(json.dumps({"png": str(png), "ico": str(ico), "sizes": sizes, "corners": "transparent", "source": "unchanged"}, indent=2))


if __name__ == "__main__":
    main()
