#!/bin/sh
# packaging/ffmpeg-lgpl-mac.sh — 설치형 앱에 실을 macOS ffmpeg 를 소스에서 짓는다(2026-11-03, RM-28).
#
#   sh packaging/ffmpeg-lgpl-mac.sh [나갈 폴더]     → <나갈 폴더>/ffmpeg (기본: packaging/build/ffmpeg)
#
# 왜 짓나: 결정(2026-10-13)이 「LGPL 빌드 + OS 하드웨어 인코더」다. 흔히 받는 맥용 정적 빌드는 libx264 를 품은
# GPL 이고, Homebrew 의 것은 다른 라이브러리에 링크되어 다른 맥에서 돌지 않는다. 그래서 바깥 라이브러리를
# 하나도 찾지 않게(--disable-autodetect) 하고 OS 에 있는 VideoToolbox · AudioToolbox 만 켠다.
#   · --enable-gpl · --enable-nonfree 를 주지 않는다 → LGPL 2.1 이상
#   · 자르기의 H.264 는 h264_videotoolbox, 소리는 ffmpeg 내장 aac — server.py 의 video_encoder_args 가 고른다
#   · 디코더 · 디먹서는 내장 것 전부(폰의 mov/mp4 · HEVC · 브라우저 녹화의 webm)
# 필요한 것: Xcode 명령줄 도구(clang) · curl · make. nasm 은 끈다(--disable-x86asm — arm64 에는 쓰이지 않는다).
# 배포할 때는 LGPL 의 조건대로 이 스크립트(어떻게 지었나)와 ffmpeg 소스의 자리를 함께 알린다(packaging/README.md).
set -eu

VERSION=7.1.1
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HERE/build/ffmpeg}
WORK=$HERE/build/ffmpeg-src
mkdir -p "$OUT" "$WORK"
cd "$WORK"
if [ ! -d "ffmpeg-$VERSION" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o ffmpeg.tar.xz
  tar -xf ffmpeg.tar.xz
fi
cd "ffmpeg-$VERSION"
./configure \
  --prefix="$WORK/prefix" \
  --disable-autodetect --disable-x86asm \
  --enable-videotoolbox --enable-audiotoolbox \
  --disable-ffplay --disable-ffprobe --disable-doc --disable-network \
  --enable-static --disable-shared \
  --extra-ldflags=-mmacosx-version-min=11.0 --extra-cflags=-mmacosx-version-min=11.0
make -j"$(sysctl -n hw.ncpu)" ffmpeg
cp ffmpeg "$OUT/ffmpeg"
"$OUT/ffmpeg" -hide_banner -version | head -3
echo "지었다: $OUT/ffmpeg"
