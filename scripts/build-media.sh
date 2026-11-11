#!/usr/bin/env bash
# Builds the ffmpeg and ffprobe that AttaCut ships, from the pinned sources in
# scripts/media-sources.json. Every library is static, so the two executables
# depend only on the operating system.
#
# Usage: scripts/build-media.sh <win-x64|linux-x64|linux-arm64|mac-x64|mac-arm64>
# win-x64 cross-compiles with mingw-w64 on Linux. The others build natively.
# Output: work/media-build/<target>/{ffmpeg,ffprobe}[.exe], LICENSE.txt, README.txt, build.json
set -euo pipefail

target=${1:?Pass a target: win-x64, linux-x64, linux-arm64, mac-x64 or mac-arm64}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
sources=$root/work/media-sources
output=$root/work/media-build/$target
build=$(mktemp -d "${TMPDIR:-/tmp}/attacut-media.XXXXXX")
prefix=$build/prefix
mkdir -p "$sources" "$prefix/lib/pkgconfig" "$prefix/include"
rm -rf "$output"
mkdir -p "$output"

case "$target" in
win-x64) host=x86_64-w64-mingw32 ;;
linux-x64 | linux-arm64 | mac-x64 | mac-arm64) host="" ;;
*)
   echo "Unknown target: $target" >&2
   exit 1
   ;;
esac
case "$(uname -s)" in
Darwin)
   jobs=$(sysctl -n hw.ncpu)
   sha256() { shasum -a 256 | cut -d' ' -f1; }
   ;;
*)
   jobs=$(nproc)
   sha256() { sha256sum | cut -d' ' -f1; }
   ;;
esac
[[ "$target" == mac-* && "$(uname -s)" != Darwin ]] && { echo "Mac targets build on macOS." >&2; exit 1; }
[[ "$target" != mac-* && "$(uname -s)" == Darwin ]] && { echo "Only Mac targets build on macOS." >&2; exit 1; }

# Fetch and verify every pinned source. A recompressed copy of the same files still matches.
manifest=$root/scripts/media-sources.json
field() { node -e 'const [file, index, key] = process.argv.slice(1); process.stdout.write(String(require(file).sources[index][key] ?? ""))' "$manifest" "$1" "$2"; }
count=$(node -e 'process.stdout.write(String(require(process.argv[1]).sources.length))' "$manifest")
untar() { case "$1" in *.xz) xz -dc "$1" ;; *) gzip -dc "$1" ;; esac; }
for ((index = 0; index < count; index++)); do
   file=$(field "$index" file)
   expected=$(field "$index" tarSha256)
   if [[ ! -f "$sources/$file" ]] || [[ "$(untar "$sources/$file" | sha256)" != "$expected" ]]; then
      curl --fail --location --silent --show-error --retry 5 --retry-all-errors --connect-timeout 20 --max-time 600 \
         --output "$sources/$file.download" "$(field "$index" url)"
      mv "$sources/$file.download" "$sources/$file"
   fi
   actual=$(untar "$sources/$file" | sha256)
   [[ "$actual" == "$expected" ]] || { echo "Source contents changed: $file, expected $expected, received $actual" >&2; exit 1; }
done
extract() {
   mkdir -p "$build/$1"
   tar -xf "$sources/$2" -C "$build/$1" --strip-components=1
}

export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
cflags="-O2 -I$prefix/include"
if [[ "$target" == mac-* ]]; then
   export MACOSX_DEPLOYMENT_TARGET=12.0
   cflags="$cflags -mmacosx-version-min=12.0"
fi
export CFLAGS="$cflags" CXXFLAGS="$cflags" LDFLAGS="-L$prefix/lib"
cxxlib=$([[ "$target" == mac-* ]] && echo -lc++ || echo -lstdc++)
autotools=(--prefix="$prefix" --enable-static --disable-shared ${host:+--host=$host})
cmake_cross=()
if [[ -n "$host" ]]; then
   export CC=$host-gcc-posix CXX=$host-g++-posix AR=$host-ar RANLIB=$host-ranlib STRIP=$host-strip
   cmake_cross=(-DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 -DCMAKE_C_COMPILER="$CC" -DCMAKE_CXX_COMPILER="$CXX"
      -DCMAKE_RC_COMPILER="$host-windres" -DCMAKE_FIND_ROOT_PATH="$prefix" -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER)
   cat > "$build/meson-cross.txt" << EOF
[binaries]
c = '$CC'
cpp = '$CXX'
ar = '$AR'
strip = '$STRIP'
windres = '$host-windres'
pkg-config = 'pkg-config'
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
fi
# Older CMakeLists in x265 request CMake 2.8 policies. CMake 4 needs this to configure them.
cmake_common=(-DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_SHARED_LIBS=OFF
   -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_POSITION_INDEPENDENT_CODE=ON "${cmake_cross[@]}")

extract zlib zlib-1.4.tar.gz
if [[ -n "$host" ]]; then
   make -C "$build/zlib" -f win32/Makefile.gcc -j"$jobs" PREFIX="$host-" libz.a
   cp "$build/zlib/libz.a" "$prefix/lib/"
   cp "$build/zlib/zlib.h" "$build/zlib/zconf.h" "$prefix/include/"
   printf 'prefix=%s\nlibdir=${prefix}/lib\nincludedir=${prefix}/include\nName: zlib\nDescription: zlib\nVersion: 1.4\nLibs: -L${libdir} -lz\nCflags: -I${includedir}\n' "$prefix" > "$prefix/lib/pkgconfig/zlib.pc"
else
   (cd "$build/zlib" && ./configure --prefix="$prefix" --static && make -j"$jobs" install)
fi

extract x264 "x264-0480cb05fa188d37ae87e8f4fd8f1aea3711f7ee.tar.gz"
(cd "$build/x264" && ./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli ${host:+--host=$host --cross-prefix=$host-} && make -j"$jobs" install)

extract x265 x265_4.2.tar.gz
cmake -S "$build/x265/source" -B "$build/x265/out" "${cmake_common[@]}" -DENABLE_SHARED=OFF -DENABLE_CLI=OFF
cmake --build "$build/x265/out" -j"$jobs"
cmake --install "$build/x265/out"
# x265 is C++. Static linking needs the C++ runtime that its pkg-config entry omits on some hosts.
grep -q -- "$cxxlib" "$prefix/lib/pkgconfig/x265.pc" || sed -i.bak "s#^Libs.private:.*#& $cxxlib#" "$prefix/lib/pkgconfig/x265.pc"
grep -q '^Libs.private:' "$prefix/lib/pkgconfig/x265.pc" || echo "Libs.private: $cxxlib -lpthread" >> "$prefix/lib/pkgconfig/x265.pc"

extract libvpx libvpx-1.17.0.tar.gz
vpx_target=()
[[ -n "$host" ]] && vpx_target=(--target=x86_64-win64-gcc)
(cd "$build/libvpx" && CROSS=${host:+$host-} ./configure --prefix="$prefix" "${vpx_target[@]}" --enable-static --disable-shared --enable-pic \
   --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp9-highbitdepth && make -j"$jobs" install)

extract libaom libaom-3.15.3.tar.gz
aom_cross=()
[[ -n "$host" ]] && aom_cross=(-DCMAKE_TOOLCHAIN_FILE="$build/libaom/build/cmake/toolchains/x86_64-mingw-gcc.cmake")
[[ -n "$host" && ! -f "$build/libaom/build/cmake/toolchains/x86_64-mingw-gcc.cmake" ]] && aom_cross=(-DCMAKE_TOOLCHAIN_FILE="$build/libaom/cmake/toolchains/x86_64-mingw-gcc.cmake")
# dav1d decodes AV1, so libaom only needs its encoder.
cmake -S "$build/libaom" -B "$build/libaom/out" "${cmake_common[@]}" "${aom_cross[@]}" -DCONFIG_AV1_DECODER=0 \
   -DENABLE_DOCS=0 -DENABLE_EXAMPLES=0 -DENABLE_TESTS=0 -DENABLE_TOOLS=0
cmake --build "$build/libaom/out" -j"$jobs"
cmake --install "$build/libaom/out"

extract dav1d dav1d-1.5.4.tar.xz
meson setup "$build/dav1d/out" "$build/dav1d" --prefix="$prefix" --libdir=lib --buildtype=release --default-library=static \
   -Denable_tools=false -Denable_tests=false ${host:+--cross-file="$build/meson-cross.txt"}
meson install -C "$build/dav1d/out"

extract zimg zimg-3.0.6.tar.gz
(cd "$build/zimg" && ./autogen.sh && ./configure "${autotools[@]}" && make -j"$jobs" install)

extract opus opus-1.5.2.tar.gz
(cd "$build/opus" && ./configure "${autotools[@]}" --disable-doc --disable-extra-programs && make -j"$jobs" install)
extract libogg libogg-1.3.6.tar.xz
(cd "$build/libogg" && ./configure "${autotools[@]}" && make -j"$jobs" install)
extract libvorbis libvorbis-1.3.7.tar.xz
(cd "$build/libvorbis" && ./configure "${autotools[@]}" --with-ogg="$prefix" --disable-docs --disable-examples && make -j"$jobs" install)
extract lame lame-3.100.tar.gz
# LAME 3.100 exports a symbol it no longer defines, which breaks some toolchains.
sed -i.bak '/lame_init_old/d' "$build/lame/include/libmp3lame.sym"
(cd "$build/lame" && ./configure "${autotools[@]}" --disable-frontend --disable-gtktest --disable-decoder && make -j"$jobs" install)

extract ffmpeg ffmpeg-8.1.3.tar.xz
ffmpeg_cross=()
ffmpeg_ldflags="-L$prefix/lib"
if [[ -n "$host" ]]; then
   ffmpeg_cross=(--target-os=mingw32 --arch=x86_64 --enable-cross-compile --cross-prefix="$host-" --cc="$CC" --cxx="$CXX")
   ffmpeg_ldflags="$ffmpeg_ldflags -static -static-libgcc -static-libstdc++"
elif [[ "$target" == linux-* ]]; then
   # glibc stays dynamic like every Linux program. The GCC runtimes go in statically.
   ffmpeg_ldflags="$ffmpeg_ldflags -static-libgcc -static-libstdc++"
fi
# Autodetection stays off, so nothing from the build machine slips into the binaries.
# Native encoders stay on: lossless copies re-encode audio with the source's own codec.
configure=(--prefix="$prefix" --pkg-config-flags=--static --extra-cflags="-I$prefix/include" --extra-ldflags="$ffmpeg_ldflags"
   --extra-libs="$cxxlib -lm" "${ffmpeg_cross[@]}" --enable-gpl --disable-autodetect --enable-static --disable-shared
   --disable-debug --disable-doc --disable-ffplay --disable-network
   --enable-libx264 --enable-libx265 --enable-libvpx --enable-libaom --enable-libdav1d --enable-libzimg
   --enable-libopus --enable-libvorbis --enable-libmp3lame --enable-zlib)
[[ "$target" == linux-* ]] && configure+=(--enable-pthreads)
[[ "$target" == mac-* ]] && configure+=(--enable-pthreads)
[[ "$target" == win-x64 ]] && configure+=(--enable-w32threads)
(cd "$build/ffmpeg" && ./configure "${configure[@]}" && make -j"$jobs")

extension=$([[ -n "$host" ]] && echo .exe || echo "")
for tool in ffmpeg ffprobe; do
   cp "$build/ffmpeg/$tool$extension" "$output/$tool$extension"
   ${STRIP:-strip} "$output/$tool$extension"
done
if [[ "$target" == mac-* ]]; then
   # Static builds must not load Homebrew or any other non-system library.
   ! otool -L "$output/ffmpeg" | tail -n +2 | grep -v -E '^\s+(/usr/lib/|/System/)' || { echo "ffmpeg links outside the system" >&2; exit 1; }
fi

{
   echo "AttaCut bundles ffmpeg and ffprobe built from source. Built with --enable-gpl, they are"
   echo "distributed under the GNU General Public License, version 2 or later, below. The libraries"
   echo "compiled into them keep their own licenses, which follow."
   for ((index = 0; index < count; index++)); do
      name=$(field "$index" name)
      echo
      echo "================================================================================"
      echo "$name $(field "$index" version): $(field "$index" license)"
      echo "================================================================================"
      for license in $(node -e 'const [file, index] = process.argv.slice(1); process.stdout.write(require(file).sources[index].licenseFiles.join(" "))' "$manifest" "$index"); do
         echo
         echo "--- $license"
         cat "$build/$name/$license"
      done
   done
} > "$output/LICENSE.txt"
cat > "$output/README.txt" << EOF
These ffmpeg and ffprobe executables were built from source by AttaCut's release workflow,
using scripts/build-media.sh and the pinned sources in scripts/media-sources.json.
The exact source archives and the build recipe are in AttaCut-sources.zip on the GitHub
release this copy of AttaCut came from: https://github.com/NoomStuff/AttaCut/releases
LICENSE.txt holds the licenses. FFmpeg: https://ffmpeg.org/
EOF
"$build/ffmpeg/ffmpeg$extension" -version > /dev/null 2>&1 || [[ -n "$host" ]]
node -e '
   const [file, target, configure] = process.argv.slice(1);
   const sources = require(file).sources.map(({ name, version, tarSha256, license }) => ({ name, version, tarSha256, license }));
   process.stdout.write(JSON.stringify({ target, configure, sources }, null, 2) + "\n");
' "$manifest" "$target" "${configure[*]}" > "$output/build.json"
rm -rf "$build"
echo "Built $output"

