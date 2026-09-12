#!/usr/bin/env python3
"""관절 위치를 **정확히 아는** 합성 테스트 영상을 만든다. 표준 라이브러리만 쓴다(PNG 를 손으로 쓴다).

    python3 tools/make-pose-clip.py video-clip/_posecheck

그리고 `python3 server.py` 로 띄운 뒤 `/tests/pose-check.html` 을 연다.
만들어진 것(약 1.1MB)은 `video-clip/` 아래라 커밋되지 않는다 — 만드는 방법만 저장소에 둔다.

분석이 맞는지 보려면 정답이 있어야 한다. 실제 춤 영상에는 "이 순간 팔꿈치가 몇 도" 라는 정답이 없으므로,
우리가 각도를 정해서 그림을 그리고 그 각도를 다시 재 본다. 재 온 값이 넣은 값과 다르면 계산이 틀린 것이다.

만드는 것:
  pose-clip.mp4    사람 모양 뼈대가 움직이는 영상(관절마다 동그라미가 찍혀 있다)
  pose-truth.json  프레임마다의 관절 좌표와, 이 영상에 넣은 각도의 정답
"""
import json, math, os, struct, subprocess, sys, zlib

W, H = 480, 640
FPS = 30
SECONDS = 4
N = FPS * SECONDS

BG = (14, 18, 30)
LIMB = (226, 232, 240)
JOINT = (34, 197, 94)
JOINT_EDGE = (6, 10, 20)


def png_bytes(w, h, pix):
    raw = b''.join(b'\x00' + bytes(pix[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    head = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head)
            + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def blank():
    buf = bytearray(W * H * 3)
    for i in range(0, len(buf), 3):
        buf[i], buf[i + 1], buf[i + 2] = BG
    return buf


def put(buf, x, y, rgb):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        buf[i], buf[i + 1], buf[i + 2] = rgb


def disc(buf, cx, cy, r, rgb):
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                put(buf, int(cx) + dx, int(cy) + dy, rgb)


def thick_line(buf, a, b, width, rgb):
    x0, y0 = a
    x1, y1 = b
    steps = int(max(abs(x1 - x0), abs(y1 - y0))) * 2 + 1
    r = width // 2
    for s in range(steps + 1):
        t = s / steps
        disc(buf, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, rgb)


def rotate(vx, vy, deg):
    a = math.radians(deg)
    return vx * math.cos(a) - vy * math.sin(a), vx * math.sin(a) + vy * math.cos(a)


def ease(t):
    """0→1→0 으로 한 번 왕복. 각도가 부드럽게 커졌다 작아진다."""
    return (1 - math.cos(2 * math.pi * t)) / 2


def skeleton(frame):
    """이 프레임의 관절 좌표(픽셀)와 이번에 넣은 각도."""
    t = frame / (N - 1)
    # 넣는 각도 — 이것이 정답이다. 관절 안쪽 각이고 180 이 곧게 편 상태다.
    left_elbow = 170 - 110 * ease(t)      # 170 → 60 → 170  (가동 범위 110)
    right_elbow = 170.0                   # 움직이지 않는다  (가동 범위 0)
    left_knee = 175 - 55 * ease(t)        # 175 → 120 → 175 (가동 범위 55)
    right_knee = 175.0

    sh_y, hip_y = 0.34 * H, 0.62 * H
    p = {
        'nose': (0.50 * W, 0.20 * H),
        'leftShoulder': (0.62 * W, sh_y), 'rightShoulder': (0.38 * W, sh_y),
        'leftHip': (0.57 * W, hip_y), 'rightHip': (0.43 * W, hip_y),
    }
    # 위팔은 어깨에서 바깥 아래로 고정, 아래팔이 팔꿈치 각만큼 접힌다.
    for side, sign, ang in (('left', +1, left_elbow), ('right', -1, right_elbow)):
        sx, sy = p[f'{side}Shoulder']
        ex, ey = sx + sign * 0.10 * W, sy + 0.16 * H
        p[f'{side}Elbow'] = (ex, ey)
        ux, uy = sx - ex, sy - ey                       # 팔꿈치 → 어깨
        n = math.hypot(ux, uy)
        wx, wy = rotate(ux / n, uy / n, sign * ang)     # 그 벡터를 각도만큼 돌린 곳이 손목
        p[f'{side}Wrist'] = (ex + wx * 0.17 * H, ey + wy * 0.17 * H)
    # 허벅지는 엉덩이에서 곧게 아래로, 종아리가 무릎 각만큼 접힌다.
    for side, sign, ang in (('left', +1, left_knee), ('right', -1, right_knee)):
        hx, hy = p[f'{side}Hip']
        kx, ky = hx, hy + 0.16 * H
        p[f'{side}Knee'] = (kx, ky)
        ux, uy = hx - kx, hy - ky
        n = math.hypot(ux, uy)
        ax, ay = rotate(ux / n, uy / n, sign * ang)
        p[f'{side}Ankle'] = (kx + ax * 0.15 * H, ky + ay * 0.15 * H)
        fx, fy = rotate(ax, ay, sign * 80)
        p[f'{side}FootIndex'] = (p[f'{side}Ankle'][0] + fx * 0.05 * H, p[f'{side}Ankle'][1] + fy * 0.05 * H)
    return p, {'leftElbow': left_elbow, 'rightElbow': right_elbow,
               'leftKnee': left_knee, 'rightKnee': right_knee}


BONES = [
    ('leftShoulder', 'rightShoulder'), ('leftShoulder', 'leftHip'), ('rightShoulder', 'rightHip'),
    ('leftHip', 'rightHip'), ('nose', 'leftShoulder'), ('nose', 'rightShoulder'),
    ('leftShoulder', 'leftElbow'), ('leftElbow', 'leftWrist'),
    ('rightShoulder', 'rightElbow'), ('rightElbow', 'rightWrist'),
    ('leftHip', 'leftKnee'), ('leftKnee', 'leftAnkle'), ('leftAnkle', 'leftFootIndex'),
    ('rightHip', 'rightKnee'), ('rightKnee', 'rightAnkle'), ('rightAnkle', 'rightFootIndex'),
]


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    frames_dir = os.path.join(out_dir, 'frames')
    os.makedirs(frames_dir, exist_ok=True)
    truth = []
    for f in range(N):
        p, angles = skeleton(f)
        buf = blank()
        for a, b in BONES:
            thick_line(buf, p[a], p[b], 9, LIMB)
        for name, (x, y) in p.items():
            disc(buf, x, y, 8, JOINT_EDGE)
            disc(buf, x, y, 6, JOINT)
        open(os.path.join(frames_dir, f'{f:04d}.png'), 'wb').write(png_bytes(W, H, buf))
        truth.append({
            'sec': round(f / FPS, 4),
            'points': {k: {'x': round(v[0] / W, 6), 'y': round(v[1] / H, 6), 'z': 0, 'score': 1} for k, v in p.items()},
            'angles': {k: round(v, 4) for k, v in angles.items()},
        })
    mp4 = os.path.join(out_dir, 'pose-clip.mp4')
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-framerate', str(FPS),
                    '-i', os.path.join(frames_dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-crf', '18', '-movflags', '+faststart', mp4], check=True)
    ranges = {}
    for key in ('leftElbow', 'rightElbow', 'leftKnee', 'rightKnee'):
        vals = [t['angles'][key] for t in truth]
        ranges[key] = {'min': round(min(vals), 3), 'max': round(max(vals), 3), 'range': round(max(vals) - min(vals), 3)}
    json.dump({'width': W, 'height': H, 'fps': FPS, 'frames': truth, 'expected': ranges},
              open(os.path.join(out_dir, 'pose-truth.json'), 'w'), ensure_ascii=False)
    print(json.dumps(ranges, indent=2))
    print('영상:', mp4, os.path.getsize(mp4), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1])
