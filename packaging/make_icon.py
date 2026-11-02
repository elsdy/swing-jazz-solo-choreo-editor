#!/usr/bin/env python3
"""설치형 앱의 아이콘을 코드로 그린다(2026-11-03, RM-28). 표준 라이브러리만 쓴다.

그림 파일을 저장소에 넣지 않고 그리는 법을 넣는다 — 바꾸고 싶으면 색과 칸을 고쳐 다시 돌리면 된다.
그림: 어두운 둥근 네모 위에 안무표처럼 8칸 격자 네 줄과, 그 위에 놓인 동작 블록 몇 개.

    python3 packaging/make_icon.py <나갈 폴더>
        → choreo.png (1024) · choreo.ico (16~256) · choreo.iconset/ (macOS iconutil 의 재료)
"""

import struct
import sys
import zlib
from pathlib import Path

BG = (24, 28, 44)
GRID = (52, 60, 86)
# 동작 블록: (줄, 시작 칸, 칸 수, 색)
BLOCKS = (
    (0, 0, 4, (236, 112, 99)),
    (0, 5, 3, (93, 173, 226)),
    (1, 1, 6, (244, 208, 63)),
    (2, 0, 2, (88, 214, 141)),
    (2, 3, 5, (175, 122, 197)),
    (3, 2, 4, (236, 112, 99)),
)
COLS, ROWS = 8, 4


# @complexity time=O(1) space=O(1) cc=7
def _inside_rounded(x, y, size, radius):
    """(x, y) 가 둥근 네모 안인가."""
    if radius <= x < size - radius or radius <= y < size - radius:
        return 0 <= x < size and 0 <= y < size
    cx = radius if x < radius else size - radius - 1
    cy = radius if y < radius else size - radius - 1
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


# @complexity time=O(n^2) space=O(n^2) cc=16
def draw(size):
    """size×size RGBA 바이트(줄마다 앞에 필터 바이트 0). PNG 의 IDAT 재료다."""
    pad = size * 0.16
    cell_w = (size - 2 * pad) / COLS
    cell_h = (size - 2 * pad) / ROWS
    gap = max(1.0, size * 0.012)
    radius = int(size * 0.22)
    paint = {}
    owner = {}                 # 칸 → 블록 번호. 같은 블록의 칸 사이에는 틈을 두지 않는다(한 덩이로 보이게)
    for row in range(ROWS):
        for col in range(COLS):
            paint[(row, col)] = GRID
    for i, (row, start, span, color) in enumerate(BLOCKS):
        for col in range(start, start + span):
            paint[(row, col)] = color
            owner[(row, col)] = i
    out = bytearray()
    for y in range(size):
        out.append(0)
        for x in range(size):
            if not _inside_rounded(x, y, size, radius):
                out += b'\x00\x00\x00\x00'
                continue
            px = BG
            gx, gy = (x - pad) / cell_w, (y - pad) / cell_h
            if 0 <= gx < COLS and 0 <= gy < ROWS:
                col, row = int(gx), int(gy)
                fx, fy = (x - pad) - col * cell_w, (y - pad) - row * cell_h
                me = owner.get((row, col))
                left = 0 if me is not None and owner.get((row, col - 1)) == me else gap
                right = 0 if me is not None and owner.get((row, col + 1)) == me else gap
                if left <= fx < cell_w - right and gap * 2 <= fy < cell_h - gap * 2:
                    px = paint[(row, col)]
            out += bytes((*px, 255))
    return bytes(out)


# @complexity time=O(n^2) space=O(n^2) cc=1
def png_bytes(size):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(draw(size), 9)) + chunk(b'IEND', b''))


# @complexity time=O(n^2) space=O(n^2) cc=2
def ico_bytes(sizes=(16, 24, 32, 48, 64, 128, 256)):
    """PNG 를 품은 ICO(윈도우 비스타 이후가 읽는다)."""
    images = [png_bytes(s) for s in sizes]
    head = struct.pack('<HHH', 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b''
    for s, img in zip(sizes, images):
        entries += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
    return head + entries + b''.join(images)


# iconutil 이 바라는 이름과 크기
ICONSET = {
    'icon_16x16.png': 16, 'icon_16x16@2x.png': 32, 'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128, 'icon_128x128@2x.png': 256, 'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512, 'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
}


# @complexity time=O(n^2) space=O(n^2) cc=2
def main(argv):
    out = Path(argv[0] if argv else 'packaging/build/icon')
    (out / 'choreo.iconset').mkdir(parents=True, exist_ok=True)
    cache = {}
    for name, s in ICONSET.items():
        cache.setdefault(s, png_bytes(s))
        (out / 'choreo.iconset' / name).write_bytes(cache[s])
    (out / 'choreo.png').write_bytes(cache[1024])
    (out / 'choreo.ico').write_bytes(ico_bytes())
    print(f'아이콘: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
